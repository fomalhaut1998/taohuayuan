// 桃源小笺（? 宣纸风物折页）与「入画巡游」（L 键一键自动山水巡航）
import * as THREE from 'three';
import { isModalBusy as sharedIsModalBusy } from './modal-state.js';
import { PROJECT_META } from './project-meta.js';

const SERIF = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif';
const STYLE_ID = 'traveler-guide-cruise-styles';

const GUIDE_CSS = `
#guide-open {
  position: fixed;
  left: 170px;
  top: 18px;
  z-index: 8;
  padding: 8px 12px;
  font-family: ${SERIF};
  font-size: 13px;
  line-height: normal;
  letter-spacing: .16em;
  color: #221d17;
  background: rgba(244, 237, 222, .92);
  border: 1px solid rgba(66, 55, 41, .3);
  border-radius: 2px;
  box-shadow: 0 2px 10px rgba(24, 20, 15, .12);
  cursor: pointer;
  transition: background-color .2s ease, border-color .2s ease, color .35s ease;
}
#guide-open span { font-size: 10px; opacity: .76; letter-spacing: 0; }
#guide-open:hover { background: rgba(235, 224, 200, .98); border-color: rgba(164, 58, 46, .48); }
body.is-night #guide-open {
  color: #f2ead9;
  background: rgba(20, 27, 33, .90);
  border-color: rgba(231, 223, 206, .32);
}
body.map-open #guide-open,
body.ui-hidden #guide-open,
body.field-guide-open #guide-open,
body.ink-epilogue-open #guide-open,
body.scroll-studio-open #guide-open,
body.quest-open #guide-open,
body.cruise-active #guide-open,
body.cruise-active #journal-open,
body.cruise-active #scroll-open,
body.cruise-active #minimap,
body.cruise-active #sky,
body.cruise-active #hud-footer,
body.cruise-active #ui-toggle,
body.cruise-active #reticle,
body.cruise-active #discovery-label,
body.cruise-active #prompt,
body.cruise-active #quiet-notice,
body.cruise-active #mystery-note,
body.cruise-active #entry-welcome-guide,
body:has(#veil:not(.curtain-gone):not([hidden])):not(.curtain-open) #guide-open,
body:has(#veil.on) #guide-open,
body:has(#veil.ink-transition) #guide-open,
body:has(#veil.ink-epilogue) #guide-open {
  visibility: hidden !important;
  pointer-events: none !important;
}
#guide-open:focus-visible { outline: 2px solid #a44f40; outline-offset: 3px; }
@media (max-width: 900px) { #guide-open { top: 14px; left: 158px; } }
@media (max-width: 600px) { #guide-open { top: 12px; left: 146px; padding: 6px 9px; font-size: 12px; letter-spacing: .1em; } }
@media (max-width: 480px) { #guide-open { top: 12px; left: 132px; padding: 6px 8px; font-size: 11.5px; letter-spacing: .08em; } }
@media (max-height: 540px) { #guide-open { top: 10px; padding: 6px 10px; } }
#traveler-guide {
  position: fixed;
  margin: auto;
  width: min(820px, 92vw);
  max-height: min(86vh, 760px);
  overflow: auto;
  padding: clamp(20px, 3vw, 30px);
  color: #2f2a24;
  background: #f3ebda;
  border: 1px solid #a99a81;
  box-shadow: 0 20px 76px rgba(23, 26, 24, .54);
  font-family: ${SERIF};
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 112, 88, 0.44) transparent;
}
#traveler-guide::-webkit-scrollbar { width: 5px; height: 5px; }
#traveler-guide::-webkit-scrollbar-thumb { background: rgba(128, 112, 88, 0.42); border-radius: 999px; }
#traveler-guide::-webkit-scrollbar-track { background: transparent; }
#traveler-guide::backdrop { background: rgba(25, 31, 27, .58); }
.tguide__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid #b5a68e;
  padding-bottom: 12px;
}
.tguide__eyebrow { color: #a43a2e; font-size: 11px; letter-spacing: .28em; }
.tguide__head h2 { font-size: 24px; font-weight: normal; letter-spacing: .22em; margin-top: 4px; }
.tguide__grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
}
.tguide__col {
  padding: 12px 14px;
  background: rgba(250, 244, 232, .65);
  border: 1px solid rgba(154, 138, 114, .34);
}
.tguide__col h3 {
  font-size: 14px;
  font-weight: normal;
  color: #a43a2e;
  letter-spacing: .22em;
  border-bottom: 1px dashed rgba(154, 138, 114, .42);
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.tguide__col ul { list-style: none; padding: 0; margin: 0; font-size: 13px; line-height: 1.85; color: #3d362e; }
.tguide__col b { font-weight: 600; color: #241f1a; }
.tguide__about {
  margin-top: 14px;
  padding: 12px 14px;
  background: rgba(249, 243, 229, .72);
  border: 1px solid rgba(154, 138, 114, .36);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tguide__about-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.tguide__about-tag {
  flex: none;
  padding: 2px 7px;
  border: 1px solid rgba(164, 58, 46, .72);
  color: #a43a2e;
  font-size: 11px;
  letter-spacing: .16em;
  line-height: 1.5;
  background: rgba(255, 250, 240, .85);
}
.tguide__about-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: #463e34;
}
.tguide__ver {
  color: #241f1a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.tguide__about-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.tguide__repo-link,
.tguide__meta-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  letter-spacing: .08em;
  color: #2f2a24;
  text-decoration: none;
  background: rgba(252, 247, 236, .88);
  border: 1px solid rgba(154, 138, 114, .48);
  transition: background-color .2s ease, border-color .2s ease, color .2s ease;
}
.tguide__repo-link:hover,
.tguide__meta-link:hover {
  color: #a43a2e;
  border-color: rgba(164, 58, 46, .56);
  background: rgba(255, 251, 242, .98);
}
.tguide__repo-link:focus-visible,
.tguide__meta-link:focus-visible {
  outline: 2px solid #a44f40;
  outline-offset: 2px;
}
.tguide__foot {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #cbbda5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  color: #6b5e4d;
}
.tguide__foot-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
#traveler-guide button {
  font: inherit;
  font-size: 13px;
  letter-spacing: .14em;
  color: #2f2a24;
  background: rgba(248, 241, 227, .85);
  border: 1px solid #b5a48a;
  padding: 7px 14px;
  cursor: pointer;
}
#traveler-guide button.tguide__primary {
  background: rgba(164, 58, 46, .92);
  color: #faf3e4;
  border-color: #8f2d22;
}
#cruise-banner {
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom, 0px) + 16px);
  transform: translateX(-50%);
  z-index: 12;
  padding: 8px 18px;
  font-family: ${SERIF};
  font-size: 13px;
  letter-spacing: .18em;
  color: #2b251f;
  background: rgba(244, 237, 222, .88);
  border: 1px solid rgba(92, 76, 56, .35);
  box-shadow: 0 4px 20px rgba(20, 20, 18, .18);
  pointer-events: auto;
  cursor: pointer;
}
#cruise-capture {
  position: fixed;
  right: max(20px, env(safe-area-inset-right, 0px) + 16px);
  bottom: max(24px, env(safe-area-inset-bottom, 0px) + 16px);
  z-index: 12;
  padding: 8px 14px;
  font-family: ${SERIF};
  font-size: 13px;
  letter-spacing: .16em;
  color: #faf3e4;
  background: rgba(164, 58, 46, .92);
  border: 1px solid #8f2d22;
  border-radius: 3px;
  box-shadow: 0 4px 20px rgba(20, 20, 18, .22);
  pointer-events: auto;
  cursor: pointer;
}
body.scroll-studio-open #cruise-banner,
body.scroll-studio-open #cruise-capture,
body.map-open #cruise-banner,
body.map-open #cruise-capture {
  visibility: hidden !important;
  pointer-events: none !important;
}
#cruise-banner[hidden],
#cruise-capture[hidden] {
  display: none !important;
}
body.is-night #cruise-banner {
  color: #f2ead9;
  background: rgba(20, 28, 34, .86);
  border-color: rgba(230, 220, 200, .3);
}
.tguide__col--touch { display: none; order: -1; }
body.touch-active .tguide__col--touch { display: block; }
@media (max-width: 720px) {
  .tguide__col--touch { display: block; }
  #cruise-banner {
    bottom: max(14px, env(safe-area-inset-bottom, 0px) + 10px);
    max-width: calc(100vw - 24px);
    width: max-content;
    padding: 8px 14px;
    font-size: 12px;
    letter-spacing: .1em;
    text-align: center;
    white-space: normal;
  }
  #cruise-capture {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    bottom: max(76px, env(safe-area-inset-bottom, 0px) + 72px);
    min-height: 40px;
    padding: 8px 18px;
  }
}
@media (max-width: 600px) {
  #traveler-guide {
    width: calc(100vw - 18px);
    max-height: 88dvh;
    padding: 16px 14px 12px;
    border-radius: 10px;
    overscroll-behavior: contain;
  }
  .tguide__head h2 { font-size: 20px; }
  .tguide__grid { grid-template-columns: 1fr; gap: 10px; }
  .tguide__about-main { flex-direction: column; gap: 6px; }
  .tguide__repo-link, .tguide__meta-link { min-height: 34px; padding: 6px 10px; }
  .tguide__foot {
    position: sticky;
    bottom: -12px;
    background: #f3ebda;
    padding: 10px 0 6px;
    margin-top: 12px;
  }
  #traveler-guide button { min-height: 38px; padding: 8px 14px; }
}
`;

// 11 处标志性山水运镜点（武陵溪 -> 桃林 -> 越崖山门 -> 村口良田 -> 美池亭林 -> 村街 -> 牛耕水碓 -> 东皋 -> 三叠泉 -> 越岭回望 -> 溪山归棹）
const CRUISE_WAYPOINTS = [
  { pos: [16, 5.4, 178], look: [6, 2.2, 118], label: '武陵溪口 · 芳草鲜美' },
  { pos: [-4, 7.6, 102], look: [10, 3.0, 42], label: '夹岸桃林 · 落英缤纷' },
  { pos: [23.5, 29.0, -8], look: [36, 5.5, -82], label: '山有小口 · 越崖入谷' },
  { pos: [34, 13.0, -62], look: [48, 3.0, -124], label: '豁然开朗 · 土地平旷' },
  { pos: [52, 10.5, -118], look: [68, 2.4, -152], label: '美池荷风 · 六博亭林' },
  { pos: [24, 10.2, -138], look: [18, 2.6, -98], label: '屋舍俨然 · 鸡犬相闻' },
  { pos: [88, 13.0, -96], look: [56, 2.6, -84], label: '春畴牛耕 · 筒车水碓' },
  { pos: [112, 19.0, -162], look: [48, 5.0, -148], label: '东皋观云 · 桑竹余荫' },
  { pos: [24, 21.0, -214], look: [26, 7.5, -248], label: '北涧三叠 · 竹坞清泉' },
  { pos: [23.5, 29.5, -8], look: [28, 3.5, -96], label: '越岭回望 · 桃源深处' },
  { pos: [6, 11.5, 132], look: [-4, 3.0, 72], label: '溪山归棹 · 芳草重寻' }
];

// 冬寂专属「入画巡游」景别：掠过武陵渡口竹筏薄冰岸、村口施茶草寮暖灯与远山寒岭流岚（同 11 节点越岭避障零热路径分配）
const WINTER_CRUISE_WAYPOINTS = [
  { pos: [27.2, 4.8, 203.5], look: [18.4, 0.2, 194.2], label: '武陵渡口 · 寒江渔火' },
  { pos: [-2, 7.6, 108], look: [10, 2.8, 44], label: '寒溪冰岸 · 素白桃林' },
  { pos: [23.5, 29.0, -8], look: [26, 4.2, -56], label: '山有小口 · 越崖观雪' },
  { pos: [29.0, 12.6, -46.0], look: [17.2, 1.8, -46.8], label: '雪村暖茗 · 豁然开朗' },
  { pos: [52, 11.6, -118], look: [68, 2.4, -152], label: '美池凝霜 · 六博亭林' },
  { pos: [24, 10.2, -138], look: [18, 2.6, -98], label: '雪覆茅檐 · 屋舍俨然' },
  { pos: [88, 13.0, -96], look: [56, 2.6, -84], label: '冬畴歇犁 · 寒溪水碓' },
  { pos: [112, 19.0, -162], look: [48, 5.0, -148], label: '东皋雪岭 · 寒山流岚' },
  { pos: [24, 21.0, -214], look: [26, 7.5, -248], label: '北涧冰泉 · 远岫飞白' },
  { pos: [23.5, 29.5, -8], look: [28, 3.5, -96], label: '雪岭回望 · 远岫寒村' },
  { pos: [8, 11.5, 148], look: [-2, 2.5, 92], label: '寒江晚渡 · 渔火重明' }
];

const CLEARANCE_SAMPLES = 192;
const CLEARANCE_RADIUS = 2.4;
const CLEARANCE_HEADROOM = 3.0;
const CLEARANCE_SMOOTH_WINDOW = 6;
const CLEARANCE_OFFSETS = [
  [0, 0],
  [CLEARANCE_RADIUS, 0],
  [-CLEARANCE_RADIUS, 0],
  [0, CLEARANCE_RADIUS],
  [0, -CLEARANCE_RADIUS]
];

const CRUISE_DURATION = 96.0; // 一周 96 秒舒缓画卷巡游
const EXIT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'KeyL']);

function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * 一次性烘焙巡游样条沿线三维障碍（山崖、岩盖、洞廓）的最小净空抬升表，
 * 使运行期零分配、平滑抬越任何遮挡山体或建筑顶面。
 */
function bakeRouteClearanceLift(curve, roots) {
  if (!curve || !roots || roots.length === 0) return null;
  const items = [];
  const localMat = new THREE.Matrix4();
  const box = new THREE.Box3();

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    if (!root || typeof root.traverse !== 'function') continue;
    root.updateMatrixWorld?.(true);
    root.traverse(obj => {
      if (!obj.isMesh || !obj.visible || !obj.geometry) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat && mat.transparent && mat.depthWrite === false) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      const gBox = obj.geometry.boundingBox;
      if (!gBox || gBox.isEmpty()) return;
      if (obj.isInstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, localMat);
          const wm = new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, localMat);
          box.copy(gBox).applyMatrix4(wm);
          if (!box.isEmpty()) {
            items.push({
              minX: box.min.x, maxX: box.max.x,
              minZ: box.min.z, maxZ: box.max.z,
              maxY: box.max.y,
              geo: obj.geometry,
              mat4: wm
            });
          }
        }
      } else {
        const wm = obj.matrixWorld.clone();
        box.copy(gBox).applyMatrix4(wm);
        if (!box.isEmpty()) {
          items.push({
            minX: box.min.x, maxX: box.max.x,
            minZ: box.min.z, maxZ: box.max.z,
            maxY: box.max.y,
            geo: obj.geometry,
            mat4: wm
          });
        }
      }
    });
  }
  if (items.length === 0) return null;

  const rawLift = new Float32Array(CLEARANCE_SAMPLES);
  const raycaster = new THREE.Raycaster();
  const downDir = new THREE.Vector3(0, -1, 0);
  const rayOrigin = new THREE.Vector3();
  const samplePos = new THREE.Vector3();
  const doubleMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probeMesh = new THREE.Mesh(undefined, doubleMat);
  probeMesh.matrixAutoUpdate = false;
  let hasLift = false;

  try {
    for (let i = 0; i < CLEARANCE_SAMPLES; i++) {
      curve.getPointAt(i / CLEARANCE_SAMPLES, samplePos);
      let maxHitY = -Infinity;
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (
          samplePos.x + CLEARANCE_RADIUS < it.minX ||
          samplePos.x - CLEARANCE_RADIUS > it.maxX ||
          samplePos.z + CLEARANCE_RADIUS < it.minZ ||
          samplePos.z - CLEARANCE_RADIUS > it.maxZ
        ) continue;
        if (it.maxY + CLEARANCE_HEADROOM <= samplePos.y) continue;

        probeMesh.geometry = it.geo;
        probeMesh.matrixWorld.copy(it.mat4);
        const startY = Math.max(200, it.maxY + 20);
        raycaster.far = startY + 500;
        for (let k = 0; k < CLEARANCE_OFFSETS.length; k++) {
          const rx = samplePos.x + CLEARANCE_OFFSETS[k][0];
          const rz = samplePos.z + CLEARANCE_OFFSETS[k][1];
          if (rx < it.minX || rx > it.maxX || rz < it.minZ || rz > it.maxZ) continue;
          rayOrigin.set(rx, startY, rz);
          raycaster.set(rayOrigin, downDir);
          const hits = raycaster.intersectObject(probeMesh, false);
          if (hits.length > 0 && hits[0].point.y > maxHitY) {
            maxHitY = hits[0].point.y;
          }
        }
      }
      if (maxHitY > -Infinity) {
        const lift = maxHitY + CLEARANCE_HEADROOM - samplePos.y;
        if (lift > 0) {
          rawLift[i] = lift;
          hasLift = true;
        }
      }
    }
  } finally {
    probeMesh.geometry = null;
    doubleMat.dispose();
  }

  if (!hasLift) return null;

  const smoothLift = new Float32Array(CLEARANCE_SAMPLES);
  for (let j = 0; j < CLEARANCE_SAMPLES; j++) {
    const val = rawLift[j];
    if (val <= 0) continue;
    for (let d = -CLEARANCE_SMOOTH_WINDOW; d <= CLEARANCE_SMOOTH_WINDOW; d++) {
      const idx = ((j + d) % CLEARANCE_SAMPLES + CLEARANCE_SAMPLES) % CLEARANCE_SAMPLES;
      const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(d)) / (CLEARANCE_SMOOTH_WINDOW + 1)));
      const lifted = val * w;
      if (lifted > smoothLift[idx]) smoothLift[idx] = lifted;
    }
  }
  return smoothLift;
}

function sampleClearanceLift(liftTable, u) {
  if (!liftTable) return 0;
  const f = (((u % 1) + 1) % 1) * CLEARANCE_SAMPLES;
  const i0 = Math.floor(f) % CLEARANCE_SAMPLES;
  const i1 = (i0 + 1) % CLEARANCE_SAMPLES;
  const alpha = f - Math.floor(f);
  return liftTable[i0] + (liftTable[i1] - liftTable[i0]) * alpha;
}

export function createTravelerGuideAndCruise({
  camera,
  player,
  canvas,
  field,
  map,
  journal,
  getScrollStudio,
  getGodFlight,
  getPhenology,
  clearanceRoots = null,
  doc = globalThis.document,
  win = globalThis.window
} = {}) {
  let disposed = false;
  let cruiseActive = false;
  let activeWinterRoute = null;
  let cruiseClock = 0;
  let lastLabel = '';
  let savedCamera = null;
  let returnFocus = null;
  let wasLocked = false;
  let standardClearanceBaked = false;
  let winterClearanceBaked = false;
  let standardClearanceLift = null;
  let winterClearanceLift = null;
  const rootsList = Array.isArray(clearanceRoots)
    ? clearanceRoots.filter(r => r && typeof r.traverse === 'function')
    : (clearanceRoots && typeof clearanceRoots.traverse === 'function' ? [clearanceRoots] : []);

  const posCurve = new THREE.CatmullRomCurve3(
    CRUISE_WAYPOINTS.map(w => new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2])),
    true,
    'catmullrom',
    0.5
  );
  const lookCurve = new THREE.CatmullRomCurve3(
    CRUISE_WAYPOINTS.map(w => new THREE.Vector3(w.look[0], w.look[1], w.look[2])),
    true,
    'catmullrom',
    0.5
  );
  const winterPosCurve = new THREE.CatmullRomCurve3(
    WINTER_CRUISE_WAYPOINTS.map(w => new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2])),
    true,
    'catmullrom',
    0.5
  );
  const winterLookCurve = new THREE.CatmullRomCurve3(
    WINTER_CRUISE_WAYPOINTS.map(w => new THREE.Vector3(w.look[0], w.look[1], w.look[2])),
    true,
    'catmullrom',
    0.5
  );
  const _pos = new THREE.Vector3();
  const _look = new THREE.Vector3();

  function isWinterSeason() {
    const raw = typeof getPhenology === 'function' ? getPhenology() : getPhenology;
    const id = typeof raw === 'string'
      ? raw
      : (raw?.currentId || raw?.getStats?.()?.phenologyId || 'spring');
    return id === 'winter';
  }

  function isWinterCruise() {
    return cruiseActive && activeWinterRoute !== null ? activeWinterRoute : isWinterSeason();
  }

  let styleEl = null;
  let openBtn = null;
  let dialogEl = null;
  let closeBtn = null;
  let godFlightBtn = null;
  let cruiseBtn = null;
  let bannerEl = null;
  let captureBtn = null;
  let createdStyle = false;
  let createdBtn = false;
  let createdDialog = false;
  let createdBanner = false;
  let createdCapture = false;
  let cleanupCaptureListener = null;

  function isModalBusy() {
    return sharedIsModalBusy(doc, {
      ignore: 'traveler-guide-open',
      includeVeil: true,
      runtime: {
        map,
        journal,
        scrollStudio: getScrollStudio?.()
      }
    });
  }

  function isGuideOpen() {
    return Boolean(dialogEl?.open);
  }

  function openGuide() {
    if (disposed || isGuideOpen() || isModalBusy()) return false;
    if (cruiseActive) stopCruise();
    if (godFlightBtn) {
      godFlightBtn.textContent = getGodFlight?.()?.active ? '退出御风（P）' : '御风飞览（P）';
    }
    returnFocus = doc?.activeElement || null;
    wasLocked = Boolean(canvas && doc?.pointerLockElement === canvas);
    player?.clearInput?.();
    if (doc?.pointerLockElement) {
      try { doc.exitPointerLock?.(); } catch {}
    }
    if (dialogEl) {
      doc?.body?.classList?.add?.('traveler-guide-open');
      if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
      else dialogEl.open = true;
      closeBtn?.focus?.();
    }
    return true;
  }

  function closeGuide() {
    if (!dialogEl || !dialogEl.open) return false;
    player?.clearInput?.();
    if (typeof dialogEl.close === 'function') dialogEl.close();
    else {
      dialogEl.open = false;
      onGuideClosed();
    }
    return true;
  }

  function onGuideClosed() {
    doc?.body?.classList?.remove?.('traveler-guide-open');
    player?.clearInput?.();
    const relock = wasLocked;
    wasLocked = false;
    if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus !== doc?.body) {
      try { returnFocus.focus(); } catch {}
    }
    if (relock && canvas) {
      try { Promise.resolve(canvas.requestPointerLock?.()).catch?.(() => {}); } catch {}
    }
  }

  function startCruise() {
    if (disposed || cruiseActive) return false;
    if (isGuideOpen()) closeGuide();
    if (isModalBusy()) return false;
    const gf = getGodFlight?.();
    if (gf?.active) gf.exit?.();
    player?.clearInput?.();
    if (doc?.pointerLockElement) {
      try { doc.exitPointerLock?.(); } catch {}
    }
    savedCamera = camera ? {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z
    } : null;
    activeWinterRoute = isWinterSeason();
    cruiseActive = true;
    doc?.body?.classList?.add?.('cruise-active');
    if (bannerEl) {
      bannerEl.hidden = false;
      updateBanner();
    }
    if (captureBtn) captureBtn.hidden = false;
    applyCruisePose();
    return true;
  }

  function ensureClearanceFloor(winter) {
    if (winter) {
      if (!winterClearanceBaked) {
        winterClearanceBaked = true;
        winterClearanceLift = bakeRouteClearanceLift(winterPosCurve, rootsList);
      }
      return winterClearanceLift;
    }
    if (!standardClearanceBaked) {
      standardClearanceBaked = true;
      standardClearanceLift = bakeRouteClearanceLift(posCurve, rootsList);
    }
    return standardClearanceLift;
  }

  function stopCruise() {
    if (!cruiseActive) return false;
    cruiseActive = false;
    activeWinterRoute = null;
    lastLabel = '';
    doc?.body?.classList?.remove?.('cruise-active');
    if (bannerEl) bannerEl.hidden = true;
    if (captureBtn) captureBtn.hidden = true;
    player?.clearInput?.();
    if (camera && player?.syncCamera) player.syncCamera(camera);
    savedCamera = null;
    return true;
  }

  function toggleCruise() {
    return cruiseActive ? stopCruise() : startCruise();
  }

  function updateBanner() {
    const u = ((cruiseClock / CRUISE_DURATION) % 1 + 1) % 1;
    const winter = isWinterCruise();
    const list = winter ? WINTER_CRUISE_WAYPOINTS : CRUISE_WAYPOINTS;
    const curve = winter ? winterPosCurve : posCurve;
    const t = curve.getUtoTmapping(u);
    const idx = ((Math.floor(t * list.length + 0.5) % list.length) + list.length) % list.length;
    const label = list[idx].label;
    if (label !== lastLabel && bannerEl) {
      lastLabel = label;
      const isTouch = Boolean(doc?.body?.classList?.contains?.('touch-active'));
      bannerEl.textContent = '入画巡游 · ' + label + (isTouch ? '（轻点归步）' : '（O 截画 · L / Esc 归步）');
    }
  }

  function applyCruisePose() {
    if (!camera) return;
    const u = ((cruiseClock / CRUISE_DURATION) % 1 + 1) % 1;
    const winter = isWinterCruise();
    const activePosCurve = winter ? winterPosCurve : posCurve;
    const activeLookCurve = winter ? winterLookCurve : lookCurve;
    activePosCurve.getPointAt(u, _pos);
    activeLookCurve.getPointAt(u, _look);
    const liftTable = ensureClearanceFloor(winter);
    if (liftTable) {
      _pos.y += sampleClearanceLift(liftTable, u);
    }
    if (field?.sample) {
      const gy = field.sample(_pos.x, _pos.z);
      if (Number.isFinite(gy) && _pos.y < gy + 2.4) _pos.y = gy + 2.4;
    }
    camera.position.copy(_pos);
    camera.lookAt(_look);
  }

  function update(dt) {
    if (disposed || !cruiseActive) return;
    if (Number.isFinite(dt) && dt > 0) {
      cruiseClock = (cruiseClock + Math.min(dt, 0.1)) % CRUISE_DURATION;
    }
    applyCruisePose();
    updateBanner();
  }

  function onKeyDown(e) {
    if (disposed || !e || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target)) return;
    if (isGuideOpen()) {
      if (e.code === 'Escape' || e.code === 'Slash') {
        e.preventDefault?.();
        closeGuide();
      }
      e.stopImmediatePropagation?.();
      return;
    }
    if (cruiseActive) {
      if (getScrollStudio?.()?.isOpen?.() || doc?.body?.classList?.contains?.('scroll-studio-open') || doc?.body?.classList?.contains?.('quest-open')) return;
      if (EXIT_CODES.has(e.code)) {
        e.preventDefault?.();
        stopCruise();
      }
      return;
    }
    if (e.code === 'Slash' && !isModalBusy()) {
      e.preventDefault?.();
      openGuide();
    } else if (e.code === 'KeyL' && !isModalBusy()) {
      e.preventDefault?.();
      startCruise();
    }
  }

  function onDialogBackdrop(e) {
    if (e.target === dialogEl) closeGuide();
  }

  if (doc?.createElement) {
    styleEl = doc.getElementById?.(STYLE_ID) || null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = GUIDE_CSS;
      (doc.head || doc.body)?.appendChild?.(styleEl);
      createdStyle = true;
    }

    openBtn = doc.getElementById?.('guide-open') || null;
    if (!openBtn && doc.body) {
      openBtn = doc.createElement('button');
      openBtn.id = 'guide-open';
      openBtn.type = 'button';
      openBtn.setAttribute?.('aria-keyshortcuts', '?');
      openBtn.title = '桃源小笺（按 ? 展开行游与风物雅趣指南）';
      openBtn.textContent = '小笺 ';
      const sp = doc.createElement('span');
      sp.textContent = '?';
      openBtn.appendChild?.(sp);
      const dockHost = doc.getElementById?.('hud-top-dock') || doc.body;
      dockHost.appendChild?.(openBtn);
      createdBtn = true;
    }

    dialogEl = doc.getElementById?.('traveler-guide') || null;
    if (!dialogEl && doc.body) {
      dialogEl = doc.createElement('dialog');
      dialogEl.id = 'traveler-guide';
      dialogEl.setAttribute?.('aria-labelledby', 'traveler-guide-title');
      dialogEl.innerHTML =
        '<header class="tguide__head">' +
          '<div><p class="tguide__eyebrow">武陵 · 行游折页</p><h2 id="traveler-guide-title">桃源小笺</h2></div>' +
          '<button id="tguide-close" type="button" aria-label="合上小笺">合</button>' +
        '</header>' +
        '<div class="tguide__grid">' +
          '<section class="tguide__col"><h3>行游与天时</h3><ul>' +
            '<li><b>WASD / Shift / 空格</b>：漫步、疾行与轻跃（可跃过矮篱、木柴、石墩等低障）</li>' +
            '<li><b>V</b>：第一 / 第三人称切换</li>' +
            '<li><b>P / B</b>：御风漫游，登高俯瞰</li>' +
            '<li><b>T / R / K</b>：晨昏、晴雨雪、四时物候</li>' +
            '<li><b>点公历</b>：4× / 暂停 · <b>Shift+点</b> 12× 观日影</li>' +
            '<li><b>M / J / Q</b>：展开舆图、行迹游记与桃源简册</li>' +
            '<li><b>H / F</b>：隐显界面与帧率监视</li>' +
          '</ul></section>' +
          '<section class="tguide__col"><h3>风物雅趣</h3><ul>' +
            '<li><b>E</b>：交谈、撑舟、落座、入席举杯</li>' +
            '<li><b>溪畔按 E</b>：放竹叶花船、青石打水漂</li>' +
            '<li><b>1–5</b>：落座或临古琴石弹五声相和</li>' +
            '<li><b>G / C</b>：近观识物入图鉴、驻足静听</li>' +
            '<li><b>X</b>：泛舟时收篙随波，听雨观鱼</li>' +
            '<li><b>随缘偶遇</b>：雨檐奉茶、夏夜扑萤、雨后挖笋</li>' +
            '<li><b>冬雪寻幽</b>：切冬寂唤雪，可识寒溪薄冰、听晴午冰檐滴水与渡口渔火</li>' +
          '</ul></section>' +
          '<section class="tguide__col"><h3>丹青与入画</h3><ul>' +
            '<li><b>O</b>：丹青画卷（横卷/立轴、青绿/浅绛/水墨）</li>' +
            '<li><b>自题私印</b>：画卷工坊支持自题短跋与朱/白文私印</li>' +
            '<li><b>画匣合卷</b>：游记画匣可一键合装四时行旅长卷</li>' +
            '<li><b>行迹时历</b>：舆图、游记与画卷同步镌刻公历时刻</li>' +
            '<li><b>冬韵舆图与题跋</b>：冬日舆图朱印标渡口茶寮，丹青随境落寒江、雪岭题跋</li>' +
            '<li><b>N</b>：雅音三档（畅响 / 轻音 / 寂静）</li>' +
            '<li><b>L</b>：一键「入画巡游」自动观览桃源山水</li>' +
          '</ul></section>' +
          '<section class="tguide__col tguide__col--touch"><h3>触屏行游</h3><ul>' +
            '<li><b>左屏摇杆</b>：轻推缓步、推至外环「疾行」；泛舟时推杆撑篙、飞览时纵览全谷</li>' +
            '<li><b>右屏划动</b>：单指轻滑环顾溪山，抬指带微惯性缓停</li>' +
            '<li><b>近观与识物</b>：轻点浮现提示或右下「观 / 识」钮交谈、登舟、入图鉴</li>' +
            '<li><b>舆图与天时</b>：轻点右上「昼夜 / 天气 / 物候 / 雅音 / 公历」即切；全图支持双指缩放与双击复原</li>' +
            '<li><b>临琴与静听</b>：落座或临琴畔出现「宫·商·角·徵·羽」轻触奏音；点「静」或提示条驻足静听</li>' +
          '</ul></section>' +
        '</div>' +
        '<section class="tguide__about" aria-label="开源与版本信息">' +
          '<div class="tguide__about-main">' +
            '<span class="tguide__about-tag">开源志</span>' +
            '<p class="tguide__about-desc">本项目基于 ' + PROJECT_META.license + ' 协议开源（当前版本 <b class="tguide__ver" data-app-version>' + PROJECT_META.versionLabel + '</b>），纯静态原生 WebGL 构建、无后端与运行时外部请求，欢迎查阅源码、反馈建议或共绘桃源。</p>' +
          '</div>' +
          '<div class="tguide__about-links">' +
            '<a class="tguide__repo-link" id="tguide-repo-link" href="' + PROJECT_META.repoUrl + '" target="_blank" rel="noopener noreferrer">' +
              '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>' +
              '<span>GitHub · ' + PROJECT_META.repoSlug + '</span>' +
            '</a>' +
            '<a class="tguide__meta-link" id="tguide-releases-link" href="' + PROJECT_META.releasesUrl + '" target="_blank" rel="noopener noreferrer">' + PROJECT_META.versionLabel + ' 版本日志</a>' +
            '<a class="tguide__meta-link" id="tguide-license-link" href="' + PROJECT_META.licenseUrl + '" target="_blank" rel="noopener noreferrer">' + PROJECT_META.license + ' 许可</a>' +
          '</div>' +
        '</section>' +
        '<footer class="tguide__foot">' +
          '<span>桃源无催促，任君行止。</span>' +
          '<div class="tguide__foot-actions">' +
            '<button id="tguide-god-flight" type="button">御风飞览（P）</button>' +
            '<button id="tguide-cruise" class="tguide__primary" type="button">开启入画巡游（L）</button>' +
          '</div>' +
        '</footer>';
      doc.body.appendChild?.(dialogEl);
      createdDialog = true;
    }
    closeBtn = dialogEl?.querySelector?.('#tguide-close') || null;
    godFlightBtn = dialogEl?.querySelector?.('#tguide-god-flight') || null;
    cruiseBtn = dialogEl?.querySelector?.('#tguide-cruise') || null;

    bannerEl = doc.getElementById?.('cruise-banner') || null;
    if (!bannerEl && doc.body) {
      bannerEl = doc.createElement('button');
      bannerEl.id = 'cruise-banner';
      bannerEl.type = 'button';
      bannerEl.hidden = true;
      doc.body.appendChild?.(bannerEl);
      createdBanner = true;
    }

    captureBtn = doc.getElementById?.('cruise-capture') || null;
    if (!captureBtn && doc.body) {
      captureBtn = doc.createElement('button');
      captureBtn.id = 'cruise-capture';
      captureBtn.type = 'button';
      captureBtn.textContent = '丹青留影';
      captureBtn.hidden = true;
      captureBtn.setAttribute?.('aria-label', '截取当前入画巡游丹青');
      doc.body.appendChild?.(captureBtn);
      createdCapture = true;
    }

    function onCruiseCaptureClick(e) {
      e?.stopPropagation?.();
      getScrollStudio?.()?.openCapture?.();
    }

    function onGodFlightClick() {
      closeGuide();
      if (cruiseActive) stopCruise();
      getGodFlight?.()?.toggle?.();
    }

    openBtn?.addEventListener?.('click', openGuide);
    closeBtn?.addEventListener?.('click', closeGuide);
    godFlightBtn?.addEventListener?.('click', onGodFlightClick);
    cruiseBtn?.addEventListener?.('click', startCruise);
    bannerEl?.addEventListener?.('click', stopCruise);
    captureBtn?.addEventListener?.('click', onCruiseCaptureClick);
    dialogEl?.addEventListener?.('close', onGuideClosed);
    dialogEl?.addEventListener?.('click', onDialogBackdrop);
    cleanupCaptureListener = () => {
      captureBtn?.removeEventListener?.('click', onCruiseCaptureClick);
      godFlightBtn?.removeEventListener?.('click', onGodFlightClick);
    };
  }

  win?.addEventListener?.('keydown', onKeyDown, true);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (cruiseActive) stopCruise();
    if (isGuideOpen()) closeGuide();
    standardClearanceLift = null;
    winterClearanceLift = null;
    rootsList.length = 0;
    win?.removeEventListener?.('keydown', onKeyDown, true);
    openBtn?.removeEventListener?.('click', openGuide);
    closeBtn?.removeEventListener?.('click', closeGuide);
    cruiseBtn?.removeEventListener?.('click', startCruise);
    bannerEl?.removeEventListener?.('click', stopCruise);
    cleanupCaptureListener?.();
    dialogEl?.removeEventListener?.('close', onGuideClosed);
    dialogEl?.removeEventListener?.('click', onDialogBackdrop);
    if (createdBtn && openBtn) openBtn.remove?.();
    if (createdDialog && dialogEl) dialogEl.remove?.();
    if (createdBanner && bannerEl) bannerEl.remove?.();
    if (createdCapture && captureBtn) captureBtn.remove?.();
    if (createdStyle && styleEl) styleEl.remove?.();
  }

  return {
    get cruiseActive() { return cruiseActive; },
    isGuideOpen,
    openGuide,
    closeGuide,
    startCruise,
    stopCruise,
    toggleCruise,
    update,
    getStats: () => ({
      guideOpen: isGuideOpen(),
      cruiseActive,
      cruiseClock: +cruiseClock.toFixed(2),
      waypoints: CRUISE_WAYPOINTS.length,
      winterRoute: isWinterCruise(),
      disposed
    }),
    dispose
  };
}
