// 舆图：全图（桃源图）与右上角小图（minimap）
// 以 mapdraw.js 的静态底图为纸本，其上叠加云烟迷雾、行迹、地名、丹青印记、所往与自身位置。
import { projectionFor, paintBase, rgba } from './mapdraw.js';
import { MAP_TIME_ANCHORS, createMapTimeTheme, mixMapColor } from './map-time-theme.js';
import { isModalBusy, isEditableTarget } from './modal-state.js';
import mapExpansion from '../data/map-expansion.json' with { type: 'json' };
import wildsEasterEggsCfg from '../data/wilds-easter-eggs.json' with { type: 'json' };

const TAU = Math.PI * 2;
const HANZI = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const FONT = '"Songti SC","STSong","SimSun","Noto Serif SC",serif';
const MAP_STORAGE_KEY = 'taohua.map.v1';

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function rectsOverlap(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function overlapArea(a, b) {
  const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

// 中文明数（至千位以下）
function hanzi(n) {
  if (n < 10) return HANZI[n < 0 ? 0 : n];
  const h = Math.floor(n / 100);
  const t = Math.floor(n / 10) % 10;
  const o = n % 10;
  let s = '';
  if (h > 0) s += HANZI[h] + '百';
  if (t > 0) {
    if (h > 0 || t > 1) s += HANZI[t];
    s += '十';
  } else if (h > 0 && o > 0) {
    s += '零';
  }
  if (o > 0) s += HANZI[o];
  return s;
}

function badgeNumeral(n) {
  if (n === 20) return '廿';
  if (n > 20 && n < 30) return '廿' + HANZI[n - 20];
  return hanzi(n);
}

// 八向：东为 +x，北为 -z
function bearingOf(dx, dz) {
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return '此地';
  const a = Math.atan2(dx, -dz);
  const i = Math.round(((a + TAU) % TAU) / (TAU / 8)) % 8;
  return DIRS[i];
}

export function createMap(cfg, world, src) {
  const appearance = createMapTimeTheme(cfg.palette, world.sky?.smoothing);
  let pal = appearance.palette;
  let baseBakes = 0;
  const lastCssVars = Object.create(null);
  let lastTargetTimeId = 'day', immediateAppearanceDraw = false, cachedVignetteKey = '', cachedVignette = null;
  const player = src.player;
  const isMainWorld = Array.isArray(cfg.pois) && cfg.pois.some(function (p) { return p && p.id === 'wuling'; });
  const extent = (isMainWorld && mapExpansion.extent) ? mapExpansion.extent : cfg.extent;
  const spanX = extent.x[1] - extent.x[0];
  const spanZ = extent.z[1] - extent.z[0];
  const waterworksWheel = src.waterworks?.wheels?.[0] || null;
  const pavilionRegion = (src.leisureGrove?.regions || []).find(function (r) { return r && r.kind === 'pavilion'; }) || null;
  const threshMark = (src.marks || []).find(function (m) { return m && m.kind === 'thresh'; }) || null;
  const qinHan = src.leisureGrove?.qinHan || src.qinHan || null;

  function resolveDynamicAnchor(entry) {
    const out = { ...entry };
    if (entry.dynamic === 'waterworks' && waterworksWheel && Number.isFinite(waterworksWheel.x) && Number.isFinite(waterworksWheel.z)) {
      out.x = waterworksWheel.x;
      out.z = waterworksWheel.z;
    } else if (entry.dynamic === 'pavilion' && pavilionRegion && Number.isFinite(pavilionRegion.x) && Number.isFinite(pavilionRegion.z)) {
      out.x = pavilionRegion.x;
      out.z = pavilionRegion.z;
    } else if (entry.dynamic === 'thresh' && threshMark && Number.isFinite(threshMark.x) && Number.isFinite(threshMark.z)) {
      out.x = threshMark.x;
      out.z = threshMark.z;
    } else if (qinHan && entry.dynamic && qinHan[entry.dynamic] && Number.isFinite(qinHan[entry.dynamic].x) && Number.isFinite(qinHan[entry.dynamic].z)) {
      out.x = qinHan[entry.dynamic].x;
      out.z = qinHan[entry.dynamic].z;
    }
    return out;
  }

  const allPois = isMainWorld
    ? cfg.pois.concat((mapExpansion.pois || []).map(resolveDynamicAnchor))
    : cfg.pois.slice();
  const allRegions = isMainWorld
    ? cfg.regions.concat((mapExpansion.regions || []).map(resolveDynamicAnchor))
    : cfg.regions.slice();
  const microLabels = isMainWorld
    ? (mapExpansion.microLabels || []).map(resolveDynamicAnchor)
    : [];
  const mountainLabels = isMainWorld
    ? (mapExpansion.mountainLabels || []).slice()
    : [];

  const fogCfg = mapExpansion.fog || {};
  const valleySplitZ = fogCfg.valleySplitZ ?? -26;
  const revealRadius = fogCfg.revealRadius ?? 44;
  const fogCols = fogCfg.cols ?? 28;
  const fogRows = fogCfg.rows ?? 14;
  const fogDx = spanZ / fogCols;
  const fogDz = spanX / fogRows;
  const explored = new Uint8Array(fogCols * fogRows);

  const zoomCfg = mapExpansion.zoom || {};
  const zoomMin = zoomCfg.min ?? 1;
  const zoomMax = zoomCfg.max ?? 3.2;
  const zoomWheelStep = zoomCfg.wheelStep ?? 0.18;
  const semanticThreshold = zoomCfg.semanticThreshold ?? 1.55;

  const slitX = Array.isArray(world.cliff?.slit) ? world.cliff.slit[0] : (world.cliff?.slit?.x ?? 23);
  const slitZ = Array.isArray(world.cliff?.slit) ? world.cliff.slit[1] : (world.cliff?.slit?.z ?? -10);

  const mapEl = document.getElementById('map');
  const sheetEl = document.getElementById('map-sheet');
  const canvasEl = document.getElementById('map-canvas');
  const closeEl = document.getElementById('map-close');
  const listEl = document.getElementById('map-list');
  const regionEl = document.getElementById('map-region');
  const destEl = document.getElementById('map-dest');
  const timeEl = document.getElementById('map-time');
  const countEl = document.getElementById('map-count');
  const noteNameEl = document.getElementById('map-note-name');
  const notePoemEl = document.getElementById('map-note-poem');
  const noteDistEl = document.getElementById('map-dist');
  const miniEl = document.getElementById('minimap');
  const miniCanvas = document.getElementById('minimap-canvas');
  const miniRegionEl = document.getElementById('minimap-region');
  const toastEl = document.getElementById('toast');
  const toastKEl = document.getElementById('toast-k');
  const toastNameEl = document.getElementById('toast-name');

  const ctx = canvasEl.getContext('2d');
  const mctx = miniCanvas.getContext('2d');

  const byId = new Map();
  allPois.forEach(function (poi) {
    byId.set(poi.id, poi);
  });

  const runtime = {
    godFlight: null,
    riverSkiff: null,
    act3Finale: null,
    phenology: null,
    scrollStudio: null,
    oxPlowing: null,
    worldClock: null,
    wulingOutskirts: null,
    wildsEasterEggs: null,
  };
  let currentPhenologyId = 'spring';
  let lastWinterSealsCount = 0;
  let lastWildsEggMarksCount = 0;
  let lastMapTimeText = '';

  const state = {
    open: false,
    wasLocked: false,
    base: null,
    geomW: 0,
    geomH: 0,
    raf: 0,
    t: 0,
    prev: 0,
    lastDraw: 0,
    miniTimer: 0,
    miniDirty: true,
    miniRotate: false,
    hoverId: null,
    hoverScroll: null,
    hoverWinterSeal: null,
    hoverWildsEgg: null,
    hoverQuestMark: null,
    destId: null,
    customDest: null,
    region: '',
    initialised: false,
    visited: new Set(src.visited || []),
    discoveredWildsEggs: new Set(),
    showWildsClues: false,
    valleyUnveiled: !isMainWorld,
    sealedNotice: false,
    zoom: 1,
    viewCx: (extent.x[0] + extent.x[1]) * 0.5,
    viewCz: (extent.z[0] + extent.z[1]) * 0.5,
    toastTimer: 0,
  };

  const _pose = { x: 0, z: 0, yaw: 0, flying: false, aboardSkiff: false };
  const visibleScrollMarks = [];
  const visibleWinterSeals = [];
  const visibleWildsEggMarks = [];
  const visibleQuestMarks = [];
  let lastScrollMarksCount = 0;
  let lastQuestMarksCount = 0;

  function getWildsEggSites() {
    const rt = runtime.wildsEasterEggs?.getSites?.();
    return (Array.isArray(rt) && rt.length) ? rt : (wildsEasterEggsCfg.sites || []);
  }

  let dragActive = false;
  let dragMoved = false;
  let dragLastX = 0;
  let dragLastY = 0;
  let lastInputCoarse = Boolean(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches);
  let pinchActive = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchLastMidX = 0;
  let pinchLastMidY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchSuppressClickUntil = 0;
  let lastTapTime = -1000;
  let lastTapX = 0;
  let lastTapY = 0;
  let prevCustomDestBeforeTap = null;
  let mapHintDefaultHtml = null;

  const rows = new Map();
  const waitForExit = new Set();

  // 名录：本传八景 + 山居风物
  allPois.forEach(function (poi, i) {
    const li = document.createElement('li');
    let cls = 'map__item';
    if (i >= cfg.pois.length) {
      cls += i === cfg.pois.length ? ' map__item--scenic map__item--scenic-first' : ' map__item--scenic';
    }
    li.className = cls;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', poi.name);
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = badgeNumeral(i + 1);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = poi.name;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(idx);
    btn.appendChild(name);
    btn.appendChild(dot);
    li.appendChild(btn);
    listEl.appendChild(li);
    rows.set(poi.id, { li: li, btn: btn, poi: poi });

    btn.addEventListener('click', function () {
      toggleDest(poi.id);
    });
    btn.addEventListener('mouseenter', function () {
      setHover(poi.id);
    });
    btn.addEventListener('mouseleave', function () {
      if (state.hoverId === poi.id) setHover(null);
    });
    btn.addEventListener('focus', function () {
      setHover(poi.id);
    });
    btn.addEventListener('blur', function () {
      if (state.hoverId === poi.id) setHover(null);
    });
  });

  state.visited.forEach(function (id) { if (byId.has(id)) markRow(id); });

  function markExplored(wx, wz, rad) {
    let changed = false;
    const r = rad || revealRadius;
    const r2 = r * r;
    const z0 = extent.z[0];
    const x1 = extent.x[1];
    for (let row = 0; row < fogRows; row++) {
      const cx = x1 - (row + 0.5) * fogDz;
      const dx = wx - cx;
      if (dx * dx > r2) continue;
      for (let col = 0; col < fogCols; col++) {
        const idx = row * fogCols + col;
        if (explored[idx]) continue;
        const cz = z0 + (col + 0.5) * fogDx;
        const dz = wz - cz;
        if (dx * dx + dz * dz <= r2) {
          explored[idx] = 1;
          changed = true;
        }
      }
    }
    return changed;
  }

  function saveFog() {
    if (typeof localStorage === 'undefined') return;
    try {
      const list = [];
      for (let i = 0; i < explored.length; i++) {
        if (explored[i]) list.push(i);
      }
      localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify({
        v: 1,
        cols: fogCols,
        rows: fogRows,
        valleyUnveiled: state.valleyUnveiled,
        explored: list,
        wildsEggs: [...state.discoveredWildsEggs],
      }));
    } catch (err) {
      /* 隐私模式存不了，无妨 */
    }
  }

  function syncVisitedFog(allowStorageRead) {
    let hasInteriorVisited = false;
    state.visited.forEach(function (id) {
      const poi = byId.get(id);
      if (!poi) return;
      if (poi.z < valleySplitZ) hasInteriorVisited = true;
      markExplored(poi.x, poi.z, Math.max(revealRadius, (poi.reveal || 24) + 18));
    });
    if (hasInteriorVisited) state.valleyUnveiled = true;
    if (allowStorageRead && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(MAP_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            if (saved.valleyUnveiled && (hasInteriorVisited || state.visited.size > 0)) {
              state.valleyUnveiled = true;
            }
            if (Array.isArray(saved.explored) && state.visited.size > 0 && saved.cols === fogCols && saved.rows === fogRows) {
              for (let i = 0; i < saved.explored.length; i++) {
                const idx = saved.explored[i];
                if (Number.isInteger(idx) && idx >= 0 && idx < explored.length) explored[idx] = 1;
              }
            }
            if (Array.isArray(saved.wildsEggs)) {
              const valid = new Set(getWildsEggSites().map(function (s) { return s.id; }));
              for (let i = 0; i < saved.wildsEggs.length; i++) {
                const eggId = saved.wildsEggs[i];
                if (typeof eggId === 'string' && valid.has(eggId)) {
                  state.discoveredWildsEggs.add(eggId);
                }
              }
            }
          }
        }
      } catch (err) {
        /* 存储不可用时仅靠当次行迹 */
      }
    }
  }
  syncVisitedFog(true);

  function resolvePose() {
    const gf = runtime.godFlight;
    if (gf && gf.active && typeof gf.getState === 'function') {
      const g = gf.getState();
      _pose.x = Number.isFinite(g.x) ? g.x : player.state.x;
      _pose.z = Number.isFinite(g.z) ? g.z : player.state.z;
      _pose.yaw = Number.isFinite(g.yaw) ? g.yaw : (player.state.yaw || 0);
      _pose.flying = true;
      _pose.aboardSkiff = false;
      return _pose;
    }
    const st = player.state;
    _pose.x = st.x;
    _pose.z = st.z;
    _pose.yaw = st.yaw || 0;
    _pose.flying = false;
    _pose.aboardSkiff = Boolean(st.aboardSkiff || runtime.riverSkiff?.getStats?.()?.aboard);
    return _pose;
  }

  function isCaveSealed() {
    if (!runtime.act3Finale) return false;
    const st = runtime.act3Finale.getState?.() || runtime.act3Finale.getStats?.();
    return Boolean(st && st.caveSealed);
  }

  function act3Snapshot() {
    if (!runtime.act3Finale) return null;
    return runtime.act3Finale.getStats?.() || runtime.act3Finale.getState?.() || null;
  }

  function dprOf() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  function releaseBase() {
    if (!state.base) return;
    // Explicitly relinquish old backing stores on resize/dispose, not an unbounded LRU.
    state.base.rasters.forEach(function (c) { c.width = 0; c.height = 0; });
    state.base = null;
  }

  function ensureBase(cssW, dpr) {
    // Three pigments share one resolution generation. At the shipped extent the
    // absolute cap is 3 * 2400 * 999 * 4 = 28,771,200 backing-store bytes.
    const MAX_RASTER_PIXELS = 2400 * 999;
    const maxW = Math.min(2400, Math.floor(Math.sqrt(MAX_RASTER_PIXELS * spanZ / spanX)));
    const target = clamp(Math.round((cssW || cfg.design) * (dpr || 1)), 1200, maxW);
    if (state.base && Math.abs(state.base.w - target) <= 16) return;
    releaseBase();
    const bh = Math.round((target * spanX) / spanZ);
    state.base = { rasters: new Map(), w: target, h: bh, ppm: target / spanZ };
    state.miniDirty = true;
    state.miniTimer = 0;
  }

  function timeRaster(index) {
    const id = MAP_TIME_ANCHORS[index];
    if (state.base.rasters.has(id)) return state.base.rasters.get(id);
    const c = document.createElement('canvas');
    c.width = state.base.w;
    c.height = state.base.h;
    const p = projectionFor(extent, c.width, c.height);
    // Topology, texture seeds and source objects are identical in every pigment.
    // Only the shallow config's palette differs; original cfg is never written.
    paintBase(c.getContext('2d'), p, { ...cfg, extent, palette: appearance.palettes[index], phenologyId: currentPhenologyId }, world, src);
    state.base.rasters.set(id, c);
    baseBakes++;
    return c;
  }

  function drawTimeBase(g, ...rectangle) {
    const weights = appearance.weights;
    let accumulated = 0;
    g.save();
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] <= 0) continue;
      accumulated += weights[i];
      // Source-over alpha is normalized cumulatively, so the final pixels are
      // the exact convex mix, even on a rapid reversal with all three in flight.
      g.globalAlpha = weights[i] / accumulated;
      g.drawImage(timeRaster(i), ...rectangle);
    }
    g.restore();
  }

  function applyAppearanceCss() {
    const vars = {
      paper: pal.paper, ink: pal.ink, seal: mixMapColor(pal.seal, pal.ink, 0.12),
      muted: mixMapColor(pal.ink, pal.paper, 0.2),
      line: mixMapColor(pal.ink, pal.paper, 0.65),
      wash: mixMapColor(pal.ink, pal.paper, 0.93),
    };
    let changed = false;
    for (const key of Object.keys(vars)) {
      if (lastCssVars[key] !== vars[key]) { changed = true; break; }
    }
    if (!changed) return;
    for (const el of [mapEl, miniEl]) {
      if (!el) continue;
      for (const key of Object.keys(vars)) {
        if (lastCssVars[key] !== vars[key]) el.style.setProperty('--map-' + key, vars[key]);
      }
    }
    for (const key of Object.keys(vars)) lastCssVars[key] = vars[key];
  }
  applyAppearanceCss();

  function measure() {
    const fallbackW = typeof window !== 'undefined' && window.innerWidth
      ? Math.min(1120, Math.max(320, window.innerWidth - 64))
      : 960;
    state.geomW = sheetEl?.clientWidth || fallbackW;
    state.geomH = sheetEl?.clientHeight || Math.round(state.geomW * 0.56);
  }

  function clampViewCenter() {
    const visZ = spanZ / state.zoom;
    const visX = spanX / state.zoom;
    const minCz = extent.z[0] + visZ * 0.5;
    const maxCz = extent.z[1] - visZ * 0.5;
    const minCx = extent.x[0] + visX * 0.5;
    const maxCx = extent.x[1] - visX * 0.5;
    state.viewCz = clamp(state.viewCz, minCz, maxCz);
    state.viewCx = clamp(state.viewCx, minCx, maxCx);
  }

  function viewProjection(W, H) {
    if (state.zoom <= 1.001) {
      state.zoom = 1;
      state.viewCx = (extent.x[0] + extent.x[1]) * 0.5;
      state.viewCz = (extent.z[0] + extent.z[1]) * 0.5;
      return projectionFor(extent, W, H);
    }
    clampViewCenter();
    const visZ = spanZ / state.zoom;
    const visX = spanX / state.zoom;
    const vz0 = state.viewCz - visZ * 0.5;
    const vz1 = state.viewCz + visZ * 0.5;
    const vx0 = state.viewCx - visX * 0.5;
    const vx1 = state.viewCx + visX * 0.5;
    const sx = W / visZ;
    const sy = H / visX;
    return {
      w: W,
      h: H,
      x0: vx0,
      x1: vx1,
      z0: vz0,
      z1: vz1,
      sx: sx,
      sy: sy,
      ppm: sx,
      px: function (x, z) { return (z - vz0) * sx; },
      py: function (x, z) { return (vx1 - x) * sy; },
    };
  }

  function unprojectScreen(p, mx, my) {
    return {
      x: p.x1 - my / p.sy,
      z: p.z0 + mx / p.sx,
    };
  }

  // ---- 可选真实 DOM 控件：缩放按钮与丹青画卷浮层 ----
  let toolsEl = null;
  let cluesBtn = null;
  let locateBtn = null;
  let zoomInBtn = null;
  let zoomOutBtn = null;
  let zoomResetBtn = null;
  let scrollCardEl = null;
  let scrollCardImg = null;
  let scrollCardTitle = null;
  let scrollCardVerse = null;
  let scrollCardEnter = null;
  let scrollCardClose = null;
  let activeScrollCardItem = null;

  function canToggleWildsClues() {
    const eggsTotal = getWildsEggSites().length;
    return isMainWorld && state.valleyUnveiled && !isCaveSealed() && eggsTotal > 0 && state.discoveredWildsEggs.size < eggsTotal;
  }

  function syncToolsUi() {
    if (!toolsEl) return;
    if (cluesBtn) {
      const visible = canToggleWildsClues();
      cluesBtn.hidden = !visible;
      if (!visible && state.showWildsClues) state.showWildsClues = false;
      cluesBtn.classList.toggle('is-active', Boolean(state.showWildsClues));
      cluesBtn.setAttribute('aria-pressed', state.showWildsClues ? 'true' : 'false');
    }
    if (zoomInBtn) zoomInBtn.disabled = state.zoom >= zoomMax - 0.02;
    if (zoomOutBtn) zoomOutBtn.disabled = state.zoom <= zoomMin + 0.02;
    if (zoomResetBtn) {
      zoomResetBtn.disabled = state.zoom <= zoomMin + 0.02;
      zoomResetBtn.textContent = state.zoom > 1.02 ? state.zoom.toFixed(1) + '×' : '全卷';
    }
  }

  function setShowWildsClues(on) {
    const next = Boolean(on) && canToggleWildsClues();
    if (state.showWildsClues === next) {
      syncToolsUi();
      return state.showWildsClues;
    }
    state.showWildsClues = next;
    syncToolsUi();
    if (state.open) drawMap(performance.now());
    return state.showWildsClues;
  }

  function hideScrollCard() {
    activeScrollCardItem = null;
    if (scrollCardEl) scrollCardEl.hidden = true;
  }

  function showScrollCard(item) {
    if (!scrollCardEl || !item) return;
    activeScrollCardItem = item;
    if (scrollCardImg) {
      scrollCardImg.src = item.dataUrl || '';
      scrollCardImg.alt = item.title || '丹青画卷';
    }
    if (scrollCardTitle) {
      const baseTitle = item.title || '桃源行纪';
      scrollCardTitle.textContent = (item.modernTime && !baseTitle.includes(item.modernTime))
        ? (baseTitle + ' · ' + item.modernTime)
        : baseTitle;
    }
    if (scrollCardVerse) scrollCardVerse.textContent = item.verse || '';
    if (scrollCardEnter) {
      scrollCardEnter.hidden = !(Number.isFinite(item.x) && Number.isFinite(item.z));
    }
    scrollCardEl.hidden = false;
  }

  function applyZoomAt(nextZoom, mx, my) {
    const W = state.geomW;
    const H = state.geomH;
    if (!W || !H) return;
    const clamped = clamp(nextZoom, zoomMin, zoomMax);
    if (clamped <= 1.02) {
      state.zoom = 1;
      clampViewCenter();
    } else {
      const oldP = viewProjection(W, H);
      const worldPt = unprojectScreen(oldP, mx, my);
      state.zoom = clamped;
      const newVisZ = spanZ / state.zoom;
      const newVisX = spanX / state.zoom;
      const newVz0 = worldPt.z - (mx / W) * newVisZ;
      const newVx1 = worldPt.x + (my / H) * newVisX;
      state.viewCz = newVz0 + newVisZ * 0.5;
      state.viewCx = newVx1 - newVisX * 0.5;
      clampViewCenter();
    }
    syncToolsUi();
    if (state.open) drawMap(performance.now());
  }

  if (sheetEl && typeof sheetEl.querySelector === 'function' && typeof document.createElement === 'function') {
    toolsEl = document.createElement('div');
    toolsEl.className = 'map__tools';
    cluesBtn = document.createElement('button');
    cluesBtn.type = 'button';
    cluesBtn.className = 'map__tool-clues';
    cluesBtn.textContent = '寻';
    cluesBtn.setAttribute('aria-label', '显隐山野秘踪');
    cluesBtn.setAttribute('title', '显隐山野秘踪线索');
    cluesBtn.setAttribute('aria-pressed', 'false');
    locateBtn = document.createElement('button');
    locateBtn.type = 'button';
    locateBtn.className = 'map__tool-locate';
    locateBtn.textContent = '我';
    locateBtn.setAttribute('aria-label', '定位当前所在');
    locateBtn.setAttribute('title', '定位当前所在');
    zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.textContent = '－';
    zoomOutBtn.setAttribute('aria-label', '缩小舆图');
    zoomResetBtn = document.createElement('button');
    zoomResetBtn.type = 'button';
    zoomResetBtn.textContent = '全卷';
    zoomResetBtn.setAttribute('aria-label', '复原全卷');
    zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.textContent = '＋';
    zoomInBtn.setAttribute('aria-label', '放大舆图');
    toolsEl.appendChild(cluesBtn);
    toolsEl.appendChild(locateBtn);
    toolsEl.appendChild(zoomOutBtn);
    toolsEl.appendChild(zoomResetBtn);
    toolsEl.appendChild(zoomInBtn);
    sheetEl.appendChild(toolsEl);

    cluesBtn.addEventListener('click', function () {
      setShowWildsClues(!state.showWildsClues);
    });
    locateBtn.addEventListener('click', function () {
      const st = resolvePose();
      state.zoom = clamp(Math.max(state.zoom, 2.0), zoomMin, zoomMax);
      state.viewCx = st.x;
      state.viewCz = st.z;
      clampViewCenter();
      syncToolsUi();
      if (state.open) drawMap(performance.now());
    });
    zoomInBtn.addEventListener('click', function () {
      applyZoomAt(state.zoom * 1.28, state.geomW * 0.5, state.geomH * 0.5);
    });
    zoomOutBtn.addEventListener('click', function () {
      applyZoomAt(state.zoom / 1.28, state.geomW * 0.5, state.geomH * 0.5);
    });
    zoomResetBtn.addEventListener('click', function () {
      applyZoomAt(1, state.geomW * 0.5, state.geomH * 0.5);
    });

    scrollCardEl = document.createElement('div');
    scrollCardEl.className = 'map__scroll-card';
    scrollCardEl.hidden = true;
    scrollCardImg = document.createElement('img');
    const head = document.createElement('div');
    head.className = 'map__scroll-card-head';
    scrollCardTitle = document.createElement('span');
    const btnGroup = document.createElement('span');
    btnGroup.style.display = 'inline-flex';
    btnGroup.style.gap = '6px';
    scrollCardEnter = document.createElement('button');
    scrollCardEnter.type = 'button';
    scrollCardEnter.className = 'map__scroll-card-close';
    scrollCardEnter.textContent = '入画重游';
    scrollCardClose = document.createElement('button');
    scrollCardClose.type = 'button';
    scrollCardClose.className = 'map__scroll-card-close';
    scrollCardClose.textContent = '收卷';
    scrollCardVerse = document.createElement('p');
    scrollCardVerse.className = 'map__scroll-card-verse';
    btnGroup.appendChild(scrollCardEnter);
    btnGroup.appendChild(scrollCardClose);
    head.appendChild(scrollCardTitle);
    head.appendChild(btnGroup);
    scrollCardEl.appendChild(scrollCardImg);
    scrollCardEl.appendChild(head);
    scrollCardEl.appendChild(scrollCardVerse);
    sheetEl.appendChild(scrollCardEl);
    scrollCardEnter.addEventListener('click', function () {
      const target = activeScrollCardItem;
      if (!target) return;
      close();
      runtime.scrollStudio?.enterScrollWorld?.(target);
    });
    scrollCardClose.addEventListener('click', hideScrollCard);
    syncToolsUi();
  }

  // ---- 全图绘制 ----

  function drawRoute(p) {
    const pts = cfg.route.points;
    if (!pts || pts.length < 2) return;
    const dash = cfg.route.dash;
    const period = dash[0] + dash[1];
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      if (!state.valleyUnveiled && pts[i][1] < valleySplitZ + 4) continue;
      const x = p.px(pts[i][0], pts[i][1]);
      const y = p.py(pts[i][0], pts[i][1]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) {
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -((state.t * cfg.route.speed) % period);
      ctx.lineWidth = cfg.route.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(pal.ink, cfg.route.alpha);
      ctx.stroke();
    }
    ctx.restore();
    // 缘溪之始
    const s = pts[0];
    ctx.beginPath();
    ctx.arc(p.px(s[0], s[1]), p.py(s[0], s[1]), 3.2, 0, TAU);
    ctx.strokeStyle = rgba(pal.ink, 0.26);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawFogAndAct3(g, p, W, H, isMini, act3, now) {
    const sealed = Boolean(act3 && act3.caveSealed);
    const hideValley = !state.valleyUnveiled || sealed;
    if (hideValley) {
      const splitX = p.px(0, valleySplitZ + 4);
      if (splitX > 0) {
        const rightEdge = Math.min(W, splitX + 26);
        const gradStart = Math.min(rightEdge - 1, splitX - 32);
        const grad = g.createLinearGradient(gradStart, 0, rightEdge, 0);
        grad.addColorStop(0, rgba(pal.paper, sealed ? 0.94 : 0.96));
        grad.addColorStop(0.55, rgba(pal.paper, sealed ? 0.84 : 0.88));
        grad.addColorStop(1, rgba(pal.paper, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, rightEdge, H);

        // 柔和云岚团雾
        const cloudCenters = [
          [-20, -195, 62, 34],
          [35, -140, 74, 42],
          [85, -165, 58, 30],
          [20, -82, 54, 28],
          [60, -228, 60, 32],
          [10, -45, 36, 22],
        ];
        for (let i = 0; i < cloudCenters.length; i++) {
          const c = cloudCenters[i];
          const cx = p.px(c[0], c[1]);
          const cy = p.py(c[0], c[1]);
          const rx = c[2] * p.sx;
          const ry = c[3] * p.sy;
          if (cx + rx < 0 || cx - rx > W || cy + ry < 0 || cy - ry > H) continue;
          g.beginPath();
          g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
          g.fillStyle = rgba(i % 2 === 0 ? pal.paperWarm : pal.paper, sealed ? 0.42 : 0.52);
          g.fill();
        }
      }
      if (!isMini && sealed) {
        // 封洞乱石记号与谷中「山岚复锁」淡墨竖题（严格保持 globalAlpha === 1）
        const sx = p.px(slitX, slitZ);
        const sy = p.py(slitX, slitZ);
        g.save();
        g.strokeStyle = rgba(pal.ink, 0.65);
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(sx - 5, sy - 6);
        g.lineTo(sx + 5, sy + 6);
        g.moveTo(sx + 5, sy - 6);
        g.lineTo(sx - 5, sy + 6);
        g.stroke();

        const tx = p.px(32, -142);
        const ty = p.py(32, -142);
        if (tx > 30 && tx < W - 30 && ty > 40 && ty < H - 40) {
          const chars = ['山', '岚', '复', '锁'];
          g.font = '15px ' + FONT;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = rgba(pal.ink, 0.42);
          for (let i = 0; i < chars.length; i++) {
            g.fillText(chars[i], tx, ty - 28 + i * 20);
          }
        }
        g.restore();
      }
    } else if (!isMini) {
      // 入谷后，对尚未踏足的边野深山留轻岚余韵，避开南崖石壁与村中盆地，步履所及自然消散
      const z0 = extent.z[0];
      const x1 = extent.x[1];
      const rx = fogDx * 0.72 * p.sx;
      const ry = fogDz * 0.72 * p.sy;
      const cl = world && world.cliff;
      const clInner = (cfg.wall && cfg.wall.inner != null ? cfg.wall.inner : 34) + 14;
      const clOuter = (cfg.wall && cfg.wall.peak != null ? cfg.wall.peak : 30) + 28;
      for (let row = 0; row < fogRows; row++) {
        const wxBase = x1 - (row + 0.5) * fogDz;
        for (let col = 0; col < fogCols; col++) {
          const wzBase = z0 + (col + 0.5) * fogDx;
          if (wzBase > valleySplitZ - 14) continue;
          const idx = row * fogCols + col;
          if (explored[idx]) continue;
          if (Math.hypot(wxBase - 30, wzBase + 125) < 74) continue;
          if (cl) {
            const dx = wxBase - cl.center[0];
            const dz = wzBase - cl.center[1];
            const dist = Math.hypot(dx, dz);
            const ang = Math.atan2(dz, dx);
            if (ang >= cl.arcFrom - 0.15 && ang <= cl.arcTo + 0.15 && dist >= cl.radius - clInner && dist <= cl.radius + clOuter) {
              continue;
            }
          }
          const jz = Math.sin(idx * 12.9898 + 1.3) * fogDx * 0.24;
          const jx = Math.cos(idx * 78.233 + 2.7) * fogDz * 0.24;
          const cx = p.px(wxBase + jx, wzBase + jz);
          const cy = p.py(wxBase + jx, wzBase + jz);
          const mr = Math.max(rx, ry) * 1.12;
          if (cx + mr < 0 || cx - mr > W || cy + mr < 0 || cy - mr > H) continue;
          const grad = g.createRadialGradient(cx, cy, mr * 0.08, cx, cy, mr);
          grad.addColorStop(0, rgba(pal.paper, 0.22));
          grad.addColorStop(0.55, rgba(pal.paper, 0.09));
          grad.addColorStop(1, rgba(pal.paper, 0));
          g.beginPath();
          g.arc(cx, cy, mr, 0, TAU);
          g.fillStyle = grad;
          g.fill();
        }
      }
    }

    // 第三幕「处处志之」：绘出已设朱砂路标志记
    if (act3 && act3.stage === 'marking' && Array.isArray(act3.markers)) {
      const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.004);
      for (let i = 0; i < act3.markers.length; i++) {
        const m = act3.markers[i];
        if (!m || !m.placed) continue;
        const mx = p.px(m.x, m.z);
        const my = p.py(m.x, m.z);
        g.beginPath();
        g.arc(mx, my, isMini ? 3.2 : 5.2 + pulse * 1.4, 0, TAU);
        g.strokeStyle = rgba(pal.seal, 0.78);
        g.lineWidth = isMini ? 1.0 : 1.2;
        g.stroke();
        g.beginPath();
        g.arc(mx, my, isMini ? 1.6 : 2.3, 0, TAU);
        g.fillStyle = rgba(pal.seal, 0.92);
        g.fill();
      }
    }
  }

  function drawWeatherOverlay(p, W, H, now) {
    const weatherId = appearance.getStats().weatherId;
    if (weatherId === 'clear') return;
    const t = (now || 0) * 0.001;
    ctx.save();
    if (weatherId === 'rain') {
      const spots = [[26, 204], [10, 120], [68, -152], [26, -246.5]];
      ctx.lineWidth = 0.9;
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        if (!state.valleyUnveiled && s[1] < valleySplitZ) continue;
        const cx = p.px(s[0], s[1]);
        const cy = p.py(s[0], s[1]);
        const phase = (t * 0.65 + i * 0.27) % 1;
        const r = 3 + phase * 11;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.strokeStyle = rgba(pal.waterEdge, (1 - phase) * 0.42);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(pal.ink, 0.065);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const x = ((i * 73 + t * 24) % (W - 40)) + 20;
        const y = ((i * 47 + t * 48) % (H - 40)) + 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6, y + 11);
      }
      ctx.stroke();
    } else if (weatherId === 'mist') {
      for (let i = 0; i < 4; i++) {
        const x = ((W * (0.18 + i * 0.22) + Math.sin(t * 0.35 + i) * 18));
        const y = H * (0.24 + (i % 2) * 0.52);
        ctx.beginPath();
        ctx.ellipse(x, y, 76, 15, 0, 0, TAU);
        ctx.fillStyle = rgba(pal.paper, 0.22);
        ctx.fill();
      }
    } else if (weatherId === 'wind') {
      for (let i = 0; i < 8; i++) {
        const x = ((i * 137 + t * 38) % (W - 40)) + 20;
        const y = ((i * 61 + Math.sin(t + i) * 14) % (H - 40)) + 20;
        ctx.beginPath();
        ctx.ellipse(x, y, 2.2, 1.1, 0.5 + i, 0, TAU);
        ctx.fillStyle = rgba(pal.peachDeep, 0.36);
        ctx.fill();
      }
    } else if (weatherId === 'snow') {
      const spanW = Math.max(16, W - 32);
      const spanH = Math.max(16, H - 32);
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = rgba(pal.ink, 0.14);
      for (let i = 0; i < 26; i++) {
        const sway = Math.sin(t * (0.65 + (i % 3) * 0.18) + i * 1.43) * 11;
        const rawX = i * 97 + sway + t * (5 + (i % 3) * 1.8);
        const rawY = i * 53 + t * (13 + (i % 4) * 3.4);
        const x = (((rawX % spanW) + spanW) % spanW) + 16;
        const y = (((rawY % spanH) + spanH) % spanH) + 16;
        const r = 1.15 + (i % 4) * 0.38;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = rgba('#FAF9F2', 0.86);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = rgba(pal.paper, 0.72);
      for (let i = 0; i < 6; i++) {
        const rawX = i * 163 + Math.cos(t * 0.55 + i * 2.1) * 9 + t * 4.2;
        const rawY = i * 89 + t * (9.5 + (i % 3) * 2.2);
        const x = (((rawX % spanW) + spanW) % spanW) + 16;
        const y = (((rawY % spanH) + spanH) % spanH) + 16;
        ctx.beginPath();
        ctx.arc(x, y, 0.85, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawSemanticMicroLayer(p, act3, now) {
    if (state.zoom < semanticThreshold) return;
    const interiorVisible = state.valleyUnveiled && !(act3 && act3.caveSealed);
    ctx.save();
    if (interiorVisible) {
      const fade = clamp((state.zoom - semanticThreshold) * 1.4 + 0.25, 0.2, 0.78);
      // 袅袅炊烟
      const chimneys = src.chimneys || [];
      const t = (now || 0) * 0.0014;
      ctx.strokeStyle = rgba(pal.ink, fade * 0.28);
      ctx.lineWidth = 0.9;
      for (let i = 0; i < chimneys.length; i++) {
        const c = chimneys[i];
        const cx = p.px(c.x, c.z);
        const cy = p.py(c.x, c.z);
        const sway = Math.sin(t + i * 1.3) * 3.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 1);
        ctx.quadraticCurveTo(cx + sway, cy - 8, cx - sway * 0.6 + 4, cy - 15);
        ctx.stroke();
      }
      // 次级题名（保持 globalAlpha === 1，透明度写在 fillStyle 中）
      ctx.font = '11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = rgba(pal.paper, fade * 0.92);
      ctx.fillStyle = rgba(pal.ink, fade * 0.85);
      for (let i = 0; i < microLabels.length; i++) {
        const m = microLabels[i];
        const mx = p.px(m.x, m.z);
        const my = p.py(m.x, m.z) - 8;
        if (mx < 16 || mx > p.w - 16 || my < 16 || my > p.h - 16) continue;
        ctx.strokeText(m.name, mx, my);
        ctx.fillText(m.name, mx, my);
      }
    }
    if (mountainLabels.length) {
      const mFade = clamp((state.zoom - semanticThreshold) * 1.35 + 0.24, 0.22, 0.64);
      ctx.font = '500 12px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = rgba(pal.paper, mFade * 0.90);
      ctx.fillStyle = rgba(pal.ink, mFade * 0.78);
      const stepY = 14;
      for (let i = 0; i < mountainLabels.length; i++) {
        const ml = mountainLabels[i];
        if (ml.z < valleySplitZ && !interiorVisible) continue;
        const mx = p.px(ml.x, ml.z);
        const my = p.py(ml.x, ml.z);
        const chars = Array.from(ml.name);
        const y0 = my - ((chars.length - 1) * stepY) * 0.5;
        if (mx < 20 || mx > p.w - 20 || y0 < 18 || y0 + (chars.length - 1) * stepY > p.h - 18) continue;
        for (let k = 0; k < chars.length; k++) {
          const cy = y0 + k * stepY;
          ctx.strokeText(chars[k], mx, cy);
          ctx.fillText(chars[k], mx, cy);
        }
      }
    }
    ctx.restore();
  }

  function resolveScrollCoord(item) {
    if (Number.isFinite(item.x) && Number.isFinite(item.z)) return { x: item.x, z: item.z };
    if (item.region) {
      const rg = allRegions.find(function (r) { return r.name === item.region; });
      if (rg) return { x: rg.x, z: rg.z };
      const po = allPois.find(function (p) { return p.name === item.region; });
      if (po) return { x: po.x, z: po.z };
    }
    return null;
  }

  function drawScrollMarks(p, act3) {
    visibleScrollMarks.length = 0;
    const saved = runtime.scrollStudio?.getSavedScrolls?.();
    if (!Array.isArray(saved) || !saved.length) {
      lastScrollMarksCount = 0;
      return;
    }
    const sealed = Boolean(act3 && act3.caveSealed);
    ctx.save();
    ctx.font = '9px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < saved.length; i++) {
      const item = saved[i];
      const pt = resolveScrollCoord(item);
      if (!pt) continue;
      if ((!state.valleyUnveiled || sealed) && pt.z < valleySplitZ) continue;
      const sx = p.px(pt.x, pt.z);
      const sy = p.py(pt.x, pt.z);
      visibleScrollMarks.push({ item: item, x: pt.x, z: pt.z, sx: sx, sy: sy });
      if (sx < 8 || sx > p.w - 8 || sy < 8 || sy > p.h - 8) continue;
      const isHover = state.hoverScroll && state.hoverScroll.id === item.id;
      const baseHalf = p.w < 580 ? 5 : 6;
      const half = isHover ? baseHalf + 1 : baseHalf;
      ctx.fillStyle = rgba(pal.paper, 0.94);
      ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
      ctx.strokeStyle = rgba(pal.seal, isHover ? 0.98 : 0.85);
      ctx.lineWidth = isHover ? 1.4 : 1.1;
      ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
      ctx.fillStyle = pal.seal;
      ctx.fillText('画', sx, sy + 0.5);
    }
    ctx.restore();
    lastScrollMarksCount = visibleScrollMarks.length;
  }

  function drawWinterOutskirtSeals(p, act3, now) {
    visibleWinterSeals.length = 0;
    const activePh = runtime.phenology?.getStats?.()?.phenologyId || currentPhenologyId;
    if (!isMainWorld || activePh !== 'winter') {
      lastWinterSealsCount = 0;
      return;
    }
    const sealed = Boolean(act3 && act3.caveSealed);
    const shelters = runtime.wulingOutskirts?.shelters || [];
    const ferrySh = shelters.find(function (s) { return s && s.id === 'wuling-ferry-pavilion'; });
    const teaSh = shelters.find(function (s) { return s && s.id === 'outskirt-tea-shelter'; });
    const marks = [
      {
        id: 'winter-ferry-seal',
        glyph: '灯',
        label: '寒江渔火',
        poem: '武陵渡口茅亭与孤筏渔灯，冬雪寒溪岸冰映照',
        x: Number.isFinite(ferrySh?.x) ? ferrySh.x : 34.6,
        z: Number.isFinite(ferrySh?.z) ? ferrySh.z : 193.8,
        interior: false,
        dx: 10,
        dy: -10
      },
      {
        id: 'winter-tea-seal',
        glyph: '茗',
        label: '雪村暖茗',
        poem: '村口迎客施茶草寮，陈桑姜茗热气袅袅，晴午冰檐滴水',
        x: Number.isFinite(teaSh?.x) ? teaSh.x : 17.2,
        z: Number.isFinite(teaSh?.z) ? teaSh.z : -46.5,
        interior: true,
        dx: 10,
        dy: 12
      }
    ];
    const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.0032);
    let drawn = 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (m.interior && (!state.valleyUnveiled || sealed)) continue;
      const sx = p.px(m.x, m.z);
      const sy = p.py(m.x, m.z);
      if (sx < 14 || sx > p.w - 14 || sy < 14 || sy > p.h - 14) continue;
      visibleWinterSeals.push({
        id: m.id,
        label: m.label,
        poem: m.poem,
        x: m.x,
        z: m.z,
        sx: sx,
        sy: sy,
        interior: m.interior
      });
      const isHover = Boolean(state.hoverWinterSeal && state.hoverWinterSeal.id === m.id);
      const isDest = Boolean(state.customDest && state.customDest.id === m.id);
      // 柔和朱印微晕环
      ctx.beginPath();
      ctx.arc(sx, sy, (isDest ? 10.2 : 8.2) + pulse * 2.2, 0, TAU);
      ctx.strokeStyle = rgba(pal.seal, (isHover || isDest ? 0.45 : 0.24) + pulse * 0.22);
      ctx.lineWidth = isDest ? 1.4 : 1.0;
      ctx.stroke();
      // 方印朱徽
      const baseHalf = p.w < 580 ? 5 : 6;
      const half = (isHover || isDest) ? baseHalf + 1 : baseHalf;
      ctx.fillStyle = rgba(pal.paper, 0.94);
      ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
      ctx.strokeStyle = rgba(pal.seal, (isHover || isDest) ? 0.98 : 0.90);
      ctx.lineWidth = (isHover || isDest) ? 1.5 : 1.2;
      ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
      ctx.textAlign = 'center';
      ctx.font = (p.w < 580 ? '600 7.5px ' : '600 8.5px ') + FONT;
      ctx.fillStyle = pal.seal;
      ctx.fillText(m.glyph, sx, sy + 0.5);
      // 雅致朱笔小注
      const estW = (typeof ctx.measureText === 'function' ? ctx.measureText(m.label)?.width : 0) || m.label.length * 10.5;
      const lx = clamp(sx + m.dx, 12, Math.max(12, p.w - 12 - estW));
      const ly = clamp(sy + m.dy, 14, Math.max(14, p.h - 14));
      ctx.textAlign = 'left';
      ctx.font = (p.w < 580 ? '9.5px ' : '10.5px ') + FONT;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = rgba(pal.paper, 0.92);
      ctx.strokeText(m.label, lx, ly);
      ctx.fillStyle = pal.seal;
      ctx.fillText(m.label, lx, ly);
      drawn += 1;
    }
    ctx.restore();
    lastWinterSealsCount = drawn;
  }

  function drawWildsEggMarks(p, act3, now) {
    visibleWildsEggMarks.length = 0;
    const sealed = Boolean(act3 && act3.caveSealed);
    if (!isMainWorld || !state.valleyUnveiled || sealed) {
      lastWildsEggMarksCount = 0;
      return;
    }
    const eggs = getWildsEggSites();
    const compact = p.w < 580;
    const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.003);
    const sealTextCol = mixMapColor(pal.seal, pal.ink, 0.12);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = (compact ? '600 7.5px ' : '600 8.5px ') + FONT;
    for (let i = 0; i < eggs.length; i++) {
      const site = eggs[i];
      if (!site || !Number.isFinite(site.x) || !Number.isFinite(site.z)) continue;
      const isFound = state.discoveredWildsEggs.has(site.id);
      if (!isFound && !state.showWildsClues && state.zoom < semanticThreshold) continue;
      const sx = p.px(site.x, site.z);
      const sy = p.py(site.x, site.z);
      if (sx < 12 || sx > p.w - 12 || sy < 12 || sy > p.h - 12) continue;
      const entry = {
        id: site.id,
        name: site.name,
        rumor: site.rumor || '',
        poem: site.poem || '',
        x: site.x,
        z: site.z,
        sx: sx,
        sy: sy,
        discovered: isFound,
      };
      visibleWildsEggMarks.push(entry);
      const isHover = Boolean(state.hoverWildsEgg && state.hoverWildsEgg.id === site.id);
      const isDest = Boolean(state.customDest && state.customDest.id === site.id);
      if (isFound) {
        if (isHover || isDest) {
          ctx.beginPath();
          ctx.arc(sx, sy, (isDest ? 9.8 : 8.2) + pulse * 1.8, 0, TAU);
          ctx.strokeStyle = rgba(pal.seal, 0.38 + pulse * 0.22);
          ctx.lineWidth = isDest ? 1.3 : 1.0;
          ctx.stroke();
        }
        const half = (compact ? 5 : 6) + ((isHover || isDest) ? 1 : 0);
        ctx.fillStyle = rgba(pal.paper, 0.94);
        ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
        ctx.strokeStyle = rgba(pal.seal, (isHover || isDest) ? 0.98 : 0.88);
        ctx.lineWidth = (isHover || isDest) ? 1.45 : 1.15;
        ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
        ctx.fillStyle = sealTextCol;
        ctx.fillText('奇', sx, sy + 0.5);
      } else {
        const rad = (compact ? 5.8 : 6.6) + ((isHover || isDest) ? 1.2 : 0);
        ctx.setLineDash([2.5, 2.5]);
        ctx.beginPath();
        ctx.arc(sx, sy, rad + pulse * 1.1, 0, TAU);
        ctx.strokeStyle = rgba(pal.ink, (isHover || isDest) ? 0.68 : 0.42);
        ctx.lineWidth = (isHover || isDest) ? 1.2 : 0.95;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(sx, sy, compact ? 4.8 : 5.4, 0, TAU);
        ctx.fillStyle = rgba(pal.paper, 0.90);
        ctx.fill();
        ctx.fillStyle = pal.ink;
        ctx.fillText('觅', sx, sy + 0.5);
      }
    }
    ctx.restore();
    lastWildsEggMarksCount = visibleWildsEggMarks.length;
  }

  function drawQuestMarks(p, act3, now) {
    visibleQuestMarks.length = 0;
    if (!runtime.questSystem?.getMapMarkers) {
      lastQuestMarksCount = 0;
      return;
    }
    const marks = runtime.questSystem.getMapMarkers() || [];
    const sealed = Boolean(act3 && act3.caveSealed);
    const compact = p.w < 580;
    const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.0034);
    const jadeCol = mixMapColor('#2d6a56', pal.ink, 0.22);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = (compact ? '600 7.5px ' : '600 8.5px ') + FONT;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
      if (isMainWorld && m.z < valleySplitZ && (!state.valleyUnveiled || sealed)) continue;
      if (m.kind === 'available' && state.zoom < semanticThreshold) continue;
      let sx = p.px(m.x, m.z);
      let sy = p.py(m.x, m.z);
      if (m.poiId && byId.has(m.poiId)) {
        sx += compact ? 11 : 14;
        sy -= compact ? 10 : 12;
      }
      if (sx < 12 || sx > p.w - 12 || sy < 12 || sy > p.h - 12) continue;
      visibleQuestMarks.push({ ...m, sx, sy });

      const isHover = Boolean(state.hoverQuestMark && state.hoverQuestMark.id === m.id);
      const isDest = Boolean(
        (state.customDest && state.customDest.id === m.id) ||
        (m.poiId && state.destId === m.poiId)
      );
      const accent = m.kind === 'active' ? jadeCol : pal.seal;
      if (m.kind === 'available') {
        const rad = (compact ? 5.6 : 6.4) + (isHover ? 1.1 : 0);
        ctx.setLineDash([2.5, 2.5]);
        ctx.beginPath();
        ctx.arc(sx, sy, rad + (isHover ? 1.4 : 0), 0, TAU);
        ctx.strokeStyle = rgba(pal.ink, isHover ? 0.72 : 0.45);
        ctx.lineWidth = isHover ? 1.2 : 0.95;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(sx, sy, compact ? 4.6 : 5.2, 0, TAU);
        ctx.fillStyle = rgba(pal.paper, 0.90);
        ctx.fill();
        ctx.fillStyle = pal.ink;
        ctx.fillText(m.glyph || '访', sx, sy + 0.5);
      } else {
        if (m.tracked || isHover || isDest) {
          ctx.beginPath();
          ctx.arc(sx, sy, (isDest ? 9.6 : 8.4) + pulse * 1.9, 0, TAU);
          ctx.strokeStyle = rgba(accent, 0.34 + pulse * 0.24);
          ctx.lineWidth = isDest ? 1.35 : 1.05;
          ctx.stroke();
        }
        const half = (compact ? 5 : 6) + ((isHover || isDest) ? 1 : 0);
        ctx.fillStyle = rgba(pal.paper, 0.94);
        ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
        ctx.strokeStyle = rgba(accent, (isHover || isDest) ? 0.98 : 0.88);
        ctx.lineWidth = (isHover || isDest) ? 1.45 : 1.15;
        ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
        ctx.fillStyle = accent;
        ctx.fillText(m.glyph || '笺', sx, sy + 0.5);
      }
    }
    ctx.restore();
    lastQuestMarksCount = visibleQuestMarks.length;
  }

  function drawCustomDest(p, now) {
    const cd = state.customDest;
    if (!cd) return;
    const sx = p.px(cd.x, cd.z);
    const sy = p.py(cd.x, cd.z);
    const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.004);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, 9 + pulse * 3, 0, TAU);
    ctx.strokeStyle = rgba(pal.seal, 0.45 + pulse * 0.3);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = rgba(pal.paper, 0.94);
    ctx.fillRect(sx - 6, sy - 6, 12, 12);
    ctx.strokeStyle = rgba(pal.seal, 0.92);
    ctx.lineWidth = 1.3;
    ctx.strokeRect(sx - 6, sy - 6, 12, 12);
    ctx.font = '600 9px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.seal;
    ctx.fillText('往', sx, sy + 0.5);
    ctx.restore();
  }

  function drawPois(p, act3) {
    const compact = p.w < 580;
    const showScenicLabels = !compact || state.zoom >= 1.45;
    const sealed = Boolean(act3 && act3.caveSealed);
    const placed = [];
    const labelQueue = [];

    // Seed occupied corner & UI control bounds so labels stay legible on small screens
    if (compact) {
      placed.push([p.w - 48, 4, p.w - 4, 50]);
      placed.push([6, p.h - 40, 40, p.h - 6]);
      placed.push([p.w - 172, p.h - 38, p.w, p.h]);
      if (!state.valleyUnveiled || state.zoom >= 1.35) {
        placed.push([10, 10, 96, 30]);
      }
      const pose = resolvePose();
      const plx = p.px(clamp(pose.x, extent.x[0], extent.x[1]), clamp(pose.z, extent.z[0], extent.z[1]));
      const ply = p.py(clamp(pose.x, extent.x[0], extent.x[1]), clamp(pose.z, extent.z[0], extent.z[1]));
      if (plx >= 0 && plx <= p.w && ply >= 0 && ply <= p.h) {
        placed.push([plx - 10, ply - 10, plx + 10, ply + 10]);
      }
    } else {
      placed.push([p.w - 64, 10, p.w - 8, 68]);
      placed.push([12, p.h - 54, 52, p.h - 14]);
      placed.push([p.w - 190, p.h - 44, p.w, p.h]);
      placed.push([18, 18, 120, 42]);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < allPois.length; i++) {
      const poi = allPois[i];
      const visited = state.visited.has(poi.id);
      if (poi.z < valleySplitZ && ((!state.valleyUnveiled && !visited) || sealed)) continue;
      const bx = poi.badge ? poi.x + poi.badge[0] : poi.x;
      const bz = poi.badge ? poi.z + poi.badge[1] : poi.z;
      const x = p.px(bx, bz);
      const y = p.py(bx, bz);
      if (x < -30 || x > p.w + 30 || y < -30 || y > p.h + 30) continue;
      const isDest = state.destId === poi.id;
      const isHover = state.hoverId === poi.id;
      const minimalDot = Boolean(poi.scenic && !showScenicLabels && !isDest && !isHover);
      const r = minimalDot ? 3.4 : (compact ? (poi.scenic ? 6.0 : 6.2) : (poi.scenic ? 6.5 : 7.5));

      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      if (minimalDot) {
        ctx.fillStyle = visited ? rgba(pal.ink, 0.72) : rgba(pal.paper, 0.9);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(pal.ink, visited ? 0.72 : 0.45);
        ctx.stroke();
      } else {
        ctx.fillStyle = visited ? rgba(pal.ink, 0.82) : rgba(pal.paper, 0.92);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(pal.ink, visited ? 0.82 : 0.5);
        ctx.stroke();
        // 序号：上一项绘制地名会改变对齐方式。
        ctx.textAlign = 'center';
        ctx.font = (compact ? (poi.scenic ? '600 7.5px ' : '600 8px ') : (poi.scenic ? '600 8px ' : '600 9px ')) + FONT;
        ctx.fillStyle = visited ? pal.paper : pal.ink;
        ctx.fillText(badgeNumeral(i + 1), x, y + 0.5);
      }
      if (isDest) {
        ctx.beginPath();
        ctx.arc(x, y, r + (compact ? 3.5 : 4.5), 0, TAU);
        ctx.strokeStyle = rgba(pal.seal, 0.85);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      if (isHover) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.2, 0, TAU);
        ctx.strokeStyle = rgba(pal.ink, 0.24);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      placed.push([x - r - 1.5, y - r - 1.5, x + r + 1.5, y + r + 1.5]);
      if (!poi.scenic || showScenicLabels || isDest || isHover) {
        const prio = isDest ? 0 : isHover ? 1 : !poi.scenic ? 2 : 3;
        labelQueue.push({ poi, i, x, y, r, isDest, isHover, prio });
      }
    }

    // Pass 2: collision-free, edge-clamped labels sorted by importance
    labelQueue.sort(function (a, b) {
      return a.prio !== b.prio ? a.prio - b.prio : a.i - b.i;
    });
    const minX = 10;
    const maxX = p.w - 10;
    const minY = 12;
    const maxY = p.h - 10;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = compact ? 3.2 : 4.4;
    ctx.strokeStyle = rgba(pal.paper, 0.94);

    for (let k = 0; k < labelQueue.length; k++) {
      const item = labelQueue[k];
      const { poi, x, y, r, isDest, isHover } = item;
      const fontStr = (compact ? (poi.scenic ? '10.5px ' : '11.5px ') : (poi.scenic ? '12px ' : '13px ')) + FONT;
      ctx.font = fontStr;
      const measuredW = typeof ctx.measureText === 'function' ? ctx.measureText(poi.name)?.width : 0;
      const tw = (Number.isFinite(measuredW) && measuredW > 0) ? measuredW : poi.name.length * (compact ? 11 : 12.5);
      const boxW = tw + 4;
      const labelH = compact ? 13 : 15;
      const prefEnd = poi.label.align === 'end';
      const gap = r + 4;
      const c1 = compact
        ? [
            x + (prefEnd ? -Math.max(Math.abs(poi.label.x) * p.ppm, gap) : Math.max(Math.abs(poi.label.x) * p.ppm, gap)),
            y - clamp(poi.label.y, -4, 4),
            prefEnd ? 'right' : 'left'
          ]
        : [x + poi.label.x * p.ppm, y - poi.label.y * p.ppm, prefEnd ? 'right' : 'left'];
      const candidates = [
        c1,
        prefEnd ? [x + gap, y, 'left'] : [x - gap, y, 'right'],
        [x, y - r - 8, 'center'],
        [x, y + r + 9, 'center'],
        prefEnd ? [x + gap, y - r - 5, 'left'] : [x - gap, y + r + 6, 'right']
      ];

      let chosen = null;
      let chosenOverlap = Infinity;
      for (let c = 0; c < candidates.length; c++) {
        const [cx, cy, align] = candidates[c];
        const rawX0 = align === 'right' ? cx - tw - 2 : align === 'center' ? cx - boxW * 0.5 : cx - 2;
        const rawY0 = cy - labelH * 0.5;
        const bx0 = clamp(rawX0, minX, Math.max(minX, maxX - boxW));
        const by0 = clamp(rawY0, minY, Math.max(minY, maxY - labelH));
        const box = [bx0, by0, bx0 + boxW, by0 + labelH];
        let ov = 0;
        for (let b = 0; b < placed.length; b++) {
          if (rectsOverlap(box, placed[b])) ov += overlapArea(box, placed[b]);
        }
        if (ov === 0) {
          chosen = box;
          chosenOverlap = 0;
          break;
        }
        if (ov < chosenOverlap) {
          chosenOverlap = ov;
          chosen = box;
        }
      }

      if (!chosen) continue;
      if (compact && chosenOverlap > 0 && !isDest && !isHover) continue;

      ctx.textAlign = 'left';
      const drawX = chosen[0] + 2;
      const drawY = chosen[1] + labelH * 0.5;
      ctx.strokeText(poi.name, drawX, drawY);
      ctx.fillStyle = pal.ink;
      ctx.fillText(poi.name, drawX, drawY);
      placed.push([chosen[0] - 2, chosen[1] - 1, chosen[2] + 2, chosen[3] + 1]);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawPlayer(p, now) {
    const st = resolvePose();
    const wx = clamp(st.x, extent.x[0], extent.x[1]);
    const wz = clamp(st.z, extent.z[0], extent.z[1]);
    const x = p.px(wx, wz);
    const y = p.py(wx, wz);
    const k = p.w < 580 ? 0.84 : 1;
    // 屏幕朝向：世界前向 (-sin yaw, -cos yaw) -> (Δx=-cos yaw, Δy=sin yaw)
    const a = Math.atan2(Math.sin(st.yaw), -Math.cos(st.yaw));
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0022);
    // 朱砂呼吸圈：无论底图多花，这一圈永远是「你在这里」
    ctx.beginPath();
    ctx.arc(x, y, (12 + pulse * 3.6) * k, 0, TAU);
    ctx.strokeStyle = rgba(pal.seal, 0.15 + pulse * 0.15);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (st.flying) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 16.5 * k, 0, TAU);
      ctx.strokeStyle = rgba(pal.seal, 0.48);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }
    // 纸色光晕：压住底下的地名与圆牌，箭头才浮得起来
    ctx.beginPath();
    ctx.arc(x, y, 6.6 * k, 0, TAU);
    ctx.fillStyle = rgba(pal.paper, 0.88);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(k, k);
    if (st.aboardSkiff) {
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.quadraticCurveTo(2, 5.2, -11, 2.2);
      ctx.lineTo(-11, -2.2);
      ctx.quadraticCurveTo(2, -5.2, 13, 0);
      ctx.closePath();
      ctx.fillStyle = rgba(pal.ink, 0.24);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.65);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(11.6, 0);
    ctx.lineTo(-6.6, 5);
    ctx.lineTo(-3.5, 0);
    ctx.lineTo(-6.6, -5);
    ctx.closePath();
    ctx.fillStyle = rgba(pal.seal, 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.paper, 0.95);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  function drawCompass(cx, cy, compact = false) {
    ctx.save();
    ctx.translate(cx, cy);
    if (compact) ctx.scale(0.76, 0.76);
    ctx.strokeStyle = rgba(pal.ink, 0.26);
    ctx.fillStyle = pal.ink;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 12.5, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.lineTo(11, 0);
    ctx.moveTo(0, -11);
    ctx.lineTo(0, 11);
    ctx.stroke();
    // 北（图左）实心
    ctx.beginPath();
    ctx.moveTo(-13.5, 0);
    ctx.lineTo(-5.5, 3.2);
    ctx.lineTo(-5.5, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.font = '9px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('北', -16, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('东', 0, -15);
    ctx.textBaseline = 'top';
    ctx.fillText('南', 0, 15);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('西', 16, 0);
    ctx.restore();
  }

  function drawSeal(x, y, compact = false) {
    const s = compact ? 22 : 30;
    const inset = compact ? 2.5 : 3;
    const p1 = s * 0.32;
    const p2 = s * 0.68;
    ctx.save();
    ctx.strokeStyle = rgba(pal.seal, 0.78);
    ctx.lineWidth = compact ? 1.2 : 1.4;
    ctx.strokeRect(x, y, s, s);
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x + inset, y + inset, s - inset * 2, s - inset * 2);
    ctx.fillStyle = mixMapColor(pal.seal, pal.ink, 0.12);
    ctx.font = (compact ? '7.5px ' : '9px ') + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('桃', x + p1, y + p1);
    ctx.fillText('花', x + p2, y + p1);
    ctx.fillText('源', x + p1, y + p2);
    ctx.fillText('记', x + p2, y + p2);
    ctx.restore();
  }

  function drawFrame(W, H) {
    const compact = W < 580;
    ctx.save();
    ctx.strokeStyle = rgba(pal.ink, 0.2);
    ctx.lineWidth = 1;
    if (compact) {
      ctx.strokeRect(6.5, 6.5, W - 13, H - 13);
      ctx.strokeStyle = rgba(pal.ink, 0.1);
      ctx.strokeRect(9.5, 9.5, W - 19, H - 19);
    } else {
      ctx.strokeRect(8.5, 8.5, W - 17, H - 17);
      ctx.strokeStyle = rgba(pal.ink, 0.1);
      ctx.strokeRect(12, 12, W - 24, H - 24);
    }
    ctx.restore();
    drawCompass(compact ? W - 24 : W - 34, compact ? 28 : 40, compact);
    drawSeal(compact ? 12 : 16, compact ? H - 34 : H - 48, compact);
    if (!(compact && state.valleyUnveiled && state.zoom < 1.35)) {
      ctx.save();
      ctx.font = (compact ? '9.5px ' : '11px ') + FONT;
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('武陵人缘溪行', compact ? 16 : 24, compact ? 20 : 30);
      ctx.restore();
    }
  }

  function drawMap(now) {
    if (!state.open || !state.base) return;
    const W = state.geomW;
    const H = state.geomH;
    if (!W || !H) return;
    const dpr = dprOf();
    const bw = Math.round(W * dpr);
    const bh = Math.round(H * dpr);
    if (canvasEl.width !== bw || canvasEl.height !== bh) {
      canvasEl.width = bw;
      canvasEl.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, W, H);
    const p = viewProjection(W, H);
    if (state.zoom <= 1.001) {
      drawTimeBase(ctx, 0, 0, W, H);
    } else {
      const baseSx = state.base.w / spanZ;
      const baseSy = state.base.h / spanX;
      const srcX = (p.z0 - extent.z[0]) * baseSx;
      const srcY = (extent.x[1] - p.x1) * baseSy;
      const srcW = (p.z1 - p.z0) * baseSx;
      const srcH = (p.x1 - p.x0) * baseSy;
      drawTimeBase(ctx, srcX, srcY, srcW, srcH, 0, 0, W, H);
    }
    const act3 = act3Snapshot();
    drawWeatherOverlay(p, W, H, now);
    drawRoute(p);
    drawFogAndAct3(ctx, p, W, H, false, act3, now);
    drawSemanticMicroLayer(p, act3, now);
    drawScrollMarks(p, act3);
    drawWinterOutskirtSeals(p, act3, now);
    drawWildsEggMarks(p, act3, now);
    drawQuestMarks(p, act3, now);
    drawPois(p, act3);
    drawCustomDest(p, now);
    drawPlayer(p, now);
    drawFrame(W, H);
  }

  // ---- 小图 ----

  function miniView() {
    const x0 = extent.x[0];
    const x1 = extent.x[1];
    const z0 = extent.z[0];
    const z1 = extent.z[1];
    const st = resolvePose();
    // 人始终在正中：走到图幅之外也无妨，图外留白，界线画一道
    const cx = x1 - x0 <= cfg.minimap.range ? (x0 + x1) / 2 : st.x;
    const cz = z1 - z0 <= cfg.minimap.range ? (z0 + z1) / 2 : st.z;
    return { cx: cx, cz: cz, scale: cfg.minimap.size / cfg.minimap.range, yaw: st.yaw, flying: st.flying, aboardSkiff: st.aboardSkiff };
  }

  function drawMiniHatch(g, size, ex0, ex1, ey0, ey1) {
    if (!(ex0 > 0 || ex1 < size || ey0 > 0 || ey1 < size)) return;
    const bands = [];
    if (ex0 > 0) bands.push([0, 0, ex0, size]);
    if (ex1 < size) bands.push([ex1, 0, size - ex1, size]);
    const tx0 = Math.max(0, ex0);
    const tx1 = Math.min(size, ex1);
    if (tx1 > tx0) {
      if (ey0 > 0) bands.push([tx0, 0, tx1 - tx0, Math.min(ey0, size)]);
      if (ey1 < size) bands.push([tx0, Math.max(0, ey1), tx1 - tx0, size - Math.max(0, ey1)]);
    }
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      g.save();
      g.beginPath();
      g.rect(b[0], b[1], b[2], b[3]);
      g.clip();
      g.strokeStyle = rgba(pal.ink, 0.055);
      g.lineWidth = 1;
      g.beginPath();
      for (let d = -size; d < size * 2; d += 7) {
        g.moveTo(d, 0);
        g.lineTo(d + size, size);
      }
      g.stroke();
      g.restore();
    }
    // 界线：墨稍重，才像纸边而不是漏图
    g.strokeStyle = rgba(pal.ink, 0.24);
    g.lineWidth = 1;
    g.strokeRect(Math.round(ex0) + 0.5, Math.round(ey0) + 0.5, Math.round(ex1 - ex0), Math.round(ey1 - ey0));
  }

  function drawMini() {
    if (!state.base) ensureBase(cfg.design, 1);
    const size = cfg.minimap.size;
    const dpr = dprOf();
    const bw = Math.round(size * dpr);
    // 宽高都要比：canvas 默认就是 300×150，1.5/2 倍屏下 bw 恰好等于 300 时
    // 只比宽度会跳过赋值，高度留在 150，整张小图被横向拉扁、人也被挤到底边
    if (miniCanvas.width !== bw || miniCanvas.height !== bw) {
      miniCanvas.width = bw;
      miniCanvas.height = bw;
    }
    const g = mctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.fillStyle = pal.paper;
    g.fillRect(0, 0, size, size);

    const v = miniView();
    const ppm = state.base.ppm;
    const range = cfg.minimap.range;
    const act3 = act3Snapshot();
    const sealed = Boolean(act3 && act3.caveSealed);
    const pose = resolvePose();

    const a = Math.atan2(Math.sin(v.yaw), -Math.cos(v.yaw));
    const rot = state.miniRotate ? (-Math.PI * 0.5 - a) : 0;

    if (!state.miniRotate) {
      const sx0 = (v.cz - range / 2 - extent.z[0]) * ppm;
      const sy0 = (extent.x[1] - (v.cx + range / 2)) * ppm;
      // 源矩形越出底图时，canvas 会按透明处理，图外自然留白
      drawTimeBase(g, sx0, sy0, range * ppm, range * ppm, 0, 0, size, size);

      const ex0 = size / 2 + (extent.z[0] - v.cz) * v.scale;
      const ex1 = size / 2 + (extent.z[1] - v.cz) * v.scale;
      const ey0 = size / 2 - (extent.x[1] - v.cx) * v.scale;
      const ey1 = size / 2 - (extent.x[0] - v.cx) * v.scale;
      drawMiniHatch(g, size, ex0, ex1, ey0, ey1);

      const miniProj = {
        px: function (x, z) { return size / 2 + (z - v.cz) * v.scale; },
        py: function (x, z) { return size / 2 - (x - v.cx) * v.scale; },
        sx: v.scale,
        sy: v.scale,
      };
      drawFogAndAct3(g, miniProj, size, size, true, act3, state.t * 1000);
    } else {
      const sub = range * 1.45;
      const subPx = size * 1.45;
      const sx0 = (v.cz - sub / 2 - extent.z[0]) * ppm;
      const sy0 = (extent.x[1] - (v.cx + sub / 2)) * ppm;
      g.save();
      g.translate(size / 2, size / 2);
      g.rotate(rot);
      drawTimeBase(g, sx0, sy0, sub * ppm, sub * ppm, -subPx * 0.5, -subPx * 0.5, subPx, subPx);
      const miniRotProj = {
        px: function (x, z) { return (z - v.cz) * v.scale; },
        py: function (x, z) { return -(x - v.cx) * v.scale; },
        sx: v.scale,
        sy: v.scale,
      };
      drawFogAndAct3(g, miniRotProj, subPx, subPx, true, act3, state.t * 1000);
      g.restore();
    }

    // Paper edge haze sits BELOW symbols and text, never washing out their contrast.
    const vgKey = pal.paper + '|' + size;
    if (cachedVignetteKey !== vgKey || !cachedVignette) {
      cachedVignetteKey = vgKey;
      const vg = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
      vg.addColorStop(0, rgba(pal.paper, 0));
      vg.addColorStop(1, rgba(pal.paper, 0.58));
      cachedVignette = vg;
    }
    g.fillStyle = cachedVignette;
    g.fillRect(0, 0, size, size);

    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    function toMiniScreen(wx, wz) {
      const rx = (wz - v.cz) * v.scale;
      const ry = -(wx - v.cx) * v.scale;
      return {
        x: size / 2 + rx * cosR - ry * sinR,
        y: size / 2 + rx * sinR + ry * cosR,
      };
    }

    // 地点
    for (let i = 0; i < allPois.length; i++) {
      const poi = allPois[i];
      const visited = state.visited.has(poi.id);
      if (poi.z < valleySplitZ && ((!state.valleyUnveiled && !visited) || sealed)) continue;
      const mp = toMiniScreen(poi.x, poi.z);
      const mx = mp.x;
      const my = mp.y;
      if (mx < 4 || mx > size - 4 || my < 4 || my > size - 4) continue;
      if (state.destId === poi.id) {
        g.beginPath();
        g.arc(mx, my, 4.4, 0, TAU);
        g.fillStyle = rgba(pal.seal, 0.9);
        g.fill();
      }
      g.beginPath();
      g.arc(mx, my, visited ? 2.6 : 2.1, 0, TAU);
      if (visited) {
        g.fillStyle = rgba(pal.ink, 0.72);
        g.fill();
      } else {
        g.strokeStyle = rgba(pal.ink, 0.42);
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // 山野七奇（已觅落朱印；未觅者近至 42m 内示虚线声迹环）
    if (isMainWorld && state.valleyUnveiled && !sealed) {
      const miniEggs = getWildsEggSites();
      const radarPulse = 0.5 + 0.5 * Math.sin(state.t * 3.2);
      for (let i = 0; i < miniEggs.length; i++) {
        const egg = miniEggs[i];
        if (!egg || !Number.isFinite(egg.x) || !Number.isFinite(egg.z)) continue;
        const isFound = state.discoveredWildsEggs.has(egg.id);
        if (!isFound && Math.hypot(pose.x - egg.x, pose.z - egg.z) > 42) continue;
        const ep = toMiniScreen(egg.x, egg.z);
        if (ep.x < 4 || ep.x > size - 4 || ep.y < 4 || ep.y > size - 4) continue;
        if (isFound) {
          g.fillStyle = rgba(pal.paper, 0.92);
          g.fillRect(ep.x - 2.6, ep.y - 2.6, 5.2, 5.2);
          g.fillStyle = rgba(pal.seal, 0.9);
          g.fillRect(ep.x - 1.8, ep.y - 1.8, 3.6, 3.6);
        } else {
          g.save();
          g.setLineDash([2, 2]);
          g.beginPath();
          g.arc(ep.x, ep.y, 3.4 + radarPulse * 1.4, 0, TAU);
          g.strokeStyle = rgba(pal.ink, 0.55);
          g.lineWidth = 1.0;
          g.stroke();
          g.setLineDash([]);
          g.restore();
        }
      }
    }

    // 闲印标记
    if (state.customDest) {
      const cp = toMiniScreen(state.customDest.x, state.customDest.z);
      if (cp.x >= 4 && cp.x <= size - 4 && cp.y >= 4 && cp.y <= size - 4) {
        g.fillStyle = rgba(pal.seal, 0.92);
        g.fillRect(cp.x - 2.4, cp.y - 2.4, 4.8, 4.8);
      }
    }

    // 所往出画时贴边为箭
    const activeDest = state.destId ? byId.get(state.destId) : state.customDest;
    if (activeDest) {
      const rx = (activeDest.z - v.cz) * v.scale;
      const ry = -(activeDest.x - v.cx) * v.scale;
      const dx = rx * cosR - ry * sinR;
      const dy = rx * sinR + ry * cosR;
      const edge = size / 2 - 9;
      if (Math.abs(dx) > edge || Math.abs(dy) > edge) {
        const k = Math.min(edge / Math.max(1e-4, Math.abs(dx)), edge / Math.max(1e-4, Math.abs(dy)));
        const ex = size / 2 + dx * k;
        const ey = size / 2 + dy * k;
        g.save();
        g.translate(ex, ey);
        g.rotate(Math.atan2(dy, dx));
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(-3, 3.4);
        g.lineTo(-3, -3.4);
        g.closePath();
        g.fillStyle = rgba(pal.seal, 0.85);
        g.fill();
        g.restore();
      }
    }

    // 自身
    const selfP = toMiniScreen(pose.x, pose.z);
    g.save();
    g.translate(selfP.x, selfP.y);
    g.rotate(state.miniRotate ? -Math.PI * 0.5 : a);
    if (pose.aboardSkiff) {
      g.beginPath();
      g.ellipse(0, 0, 7.6, 2.4, 0, 0, TAU);
      g.fillStyle = rgba(pal.ink, 0.35);
      g.fill();
    }
    g.beginPath();
    g.moveTo(6.4, 0);
    g.lineTo(-4, 3.2);
    g.lineTo(-2.4, 0);
    g.lineTo(-4, -3.2);
    g.closePath();
    g.fillStyle = rgba(pal.seal, 0.95);
    g.fill();
    g.strokeStyle = rgba(pal.paper, 0.9);
    g.lineWidth = 0.9;
    g.stroke();
    g.restore();

    // 北（定卷在左 / 随目动态指北针）
    const cpx = 15;
    const cpy = 15;
    g.beginPath();
    g.arc(cpx, cpy, 8.4, 0, TAU);
    g.fillStyle = rgba(pal.paper, 0.88);
    g.fill();
    g.strokeStyle = rgba(pal.ink, state.miniRotate ? 0.36 : 0.14);
    g.lineWidth = 1;
    g.stroke();
    if (state.miniRotate) {
      const northAng = Math.PI + rot;
      g.save();
      g.translate(cpx, cpy);
      g.rotate(northAng);
      g.beginPath();
      g.moveTo(7.4, 0);
      g.lineTo(3.2, 2.1);
      g.lineTo(3.2, -2.1);
      g.closePath();
      g.fillStyle = rgba(pal.seal, 0.85);
      g.fill();
      g.restore();
    }
    g.font = '8px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = pal.ink;
    g.fillText('北', cpx, cpy + 0.5);

    if (miniRegionEl && miniRegionEl.textContent !== state.region) miniRegionEl.textContent = state.region;
  }

  // ---- 文案与状态 ----

  function regionAt(x, z) {
    let best = '';
    let score = 0;
    for (let i = 0; i < allRegions.length; i++) {
      const rg = allRegions[i];
      const d = Math.hypot(x - rg.x, z - rg.z);
      if (d >= rg.r) continue;
      const s = (1 - d / rg.r) + (rg.priority || 0);
      if (s > score) {
        score = s;
        best = rg.name;
      }
    }
    return best || '桃花源';
  }

  function updateRegion(x, z) {
    const r = regionAt(x, z);
    if (r === state.region) return;
    state.region = r;
    if (regionEl) regionEl.textContent = r;
    if (miniRegionEl) miniRegionEl.textContent = r;
    state.miniDirty = true;
  }

  function showToast(name, all, kicker) {
    if (!toastEl) return;
    toastNameEl.textContent = name;
    toastKEl.textContent = kicker !== undefined ? kicker : (all ? '' : '已至');
    toastEl.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      state.toastTimer = 0;
      toastEl.classList.remove('show');
    }, all ? 4200 : 2400);
  }

  function markRow(id) {
    const row = rows.get(id);
    if (!row) return;
    row.li.classList.toggle('is-visited', state.visited.has(id));
  }

  function updateCount() {
    const n = state.visited.size;
    const total = allPois.length;
    if (!countEl) return;
    let baseText;
    if (n >= total) {
      baseText = '桃源已尽览';
      countEl.classList.add('is-all');
    } else {
      baseText = '已至 ' + hanzi(n) + ' / ' + hanzi(total);
      countEl.classList.remove('is-all');
    }
    const eggsTotal = getWildsEggSites().length;
    const eggsFound = state.discoveredWildsEggs.size;
    if (eggsFound > 0 && eggsTotal > 0) {
      baseText += eggsFound >= eggsTotal ? ' · 七奇尽览' : (' · 奇踪 ' + hanzi(eggsFound) + ' / ' + hanzi(eggsTotal));
    }
    countEl.textContent = baseText;
  }

  function markWildsEggDiscovered(site) {
    if (!site || !site.id) return false;
    const isNew = !state.discoveredWildsEggs.has(site.id);
    state.discoveredWildsEggs.add(site.id);
    state.valleyUnveiled = true;
    if (Number.isFinite(site.x) && Number.isFinite(site.z)) {
      markExplored(site.x, site.z, 26);
    }
    saveFog();
    updateCount();
    syncToolsUi();
    state.miniDirty = true;
    if (isNew && state.initialised) {
      showToast(site.name, false, '山野奇遇');
      const totalEggs = getWildsEggSites().length;
      if (totalEggs > 0 && state.discoveredWildsEggs.size >= totalEggs) {
        setTimeout(function () {
          showToast('山野七奇尽览', true, '桃源秘藏');
        }, 900);
      }
    }
    if (state.open) drawMap(performance.now());
    return isNew;
  }

  function nearestPoi() {
    const st = resolvePose();
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < allPois.length; i++) {
      const poi = allPois[i];
      if (!state.valleyUnveiled && poi.z < valleySplitZ && !state.visited.has(poi.id)) continue;
      const d = Math.hypot(st.x - poi.x, st.z - poi.z);
      if (d < bd) {
        bd = d;
        best = poi;
      }
    }
    return best;
  }

  function updateNote() {
    if (!noteNameEl) return;
    if (state.sealedNotice) {
      state.sealedNotice = false;
      noteNameEl.textContent = '迷津难寻';
      if (notePoemEl) notePoemEl.textContent = '山岚复锁，旧路难寻';
      if (noteDistEl) noteDistEl.textContent = '不复得路';
      return;
    }
    if (state.hoverScroll) {
      noteNameEl.textContent = state.hoverScroll.title || '丹青画卷';
      if (notePoemEl) notePoemEl.textContent = state.hoverScroll.verse || '';
      if (noteDistEl) noteDistEl.textContent = '点按可展卷重温';
      return;
    }
    if (state.hoverWinterSeal) {
      const ws = state.hoverWinterSeal;
      noteNameEl.textContent = ws.label;
      if (notePoemEl) notePoemEl.textContent = ws.poem || '';
      const isSelected = Boolean(state.customDest && state.customDest.id === ws.id);
      if (noteDistEl) noteDistEl.textContent = isSelected ? '已定所往 · 点按撤除' : '冬雪朱印 · 点按设为所往';
      return;
    }
    if (state.hoverWildsEgg) {
      const we = state.hoverWildsEgg;
      noteNameEl.textContent = we.discovered ? we.name : '山野奇踪 · 未觅';
      if (notePoemEl) notePoemEl.textContent = we.discovered ? (we.poem || '') : (we.rumor || '');
      const isSelected = Boolean(state.customDest && state.customDest.id === we.id);
      if (noteDistEl) {
        noteDistEl.textContent = isSelected
          ? '已定所往 · 点按撤除'
          : (we.discovered ? '山野奇遇 · 点按设为所往' : '传闻线索 · 点按设为所往');
      }
      return;
    }
    if (state.hoverQuestMark) {
      const qm = state.hoverQuestMark;
      noteNameEl.textContent = qm.title || '桃源简册';
      if (notePoemEl) notePoemEl.textContent = qm.subtitle || '';
      const isSelected = Boolean(
        (state.customDest && state.customDest.id === qm.id) ||
        (qm.poiId && state.destId === qm.poiId)
      );
      if (noteDistEl) {
        noteDistEl.textContent = isSelected ? '已定风丝所往 · 点按撤除' : '桃源简册 · 点按设为风丝所往';
      }
      return;
    }
    let poi = null;
    if (state.hoverId) poi = byId.get(state.hoverId) || null;
    if (!poi && state.destId) poi = byId.get(state.destId) || null;
    if (!poi && state.customDest) poi = state.customDest;
    if (!poi) poi = nearestPoi();
    if (!poi) return;
    noteNameEl.textContent = poi.name;
    if (notePoemEl) notePoemEl.textContent = poi.poem || '';
    const st = resolvePose();
    const dx = poi.x - st.x;
    const dz = poi.z - st.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(
      cfg.units.stepRound,
      Math.round(dist / cfg.units.stepMeters / cfg.units.stepRound) * cfg.units.stepRound
    );
    const near = dist < cfg.units.stepMeters * cfg.units.stepRound * 0.5;
    if (noteDistEl) noteDistEl.textContent = near ? '此地' : bearingOf(dx, dz) + ' · 约 ' + hanzi(steps) + ' 步';
  }

  function setHover(id) {
    if (state.hoverId === id) return;
    state.hoverId = id;
    rows.forEach(function (row, key) {
      row.li.classList.toggle('is-hover', key === id);
    });
    updateNote();
    if (state.open) drawMap(performance.now());
  }

  function syncTimeUi() {
    if (!timeEl) return;
    const wc = runtime.worldClock || src.worldClock;
    const st = wc?.getState?.();
    const txt = typeof st?.modernText === 'string' ? st.modernText.trim() : '';
    if (txt && txt !== lastMapTimeText) {
      lastMapTimeText = txt;
      timeEl.textContent = txt;
      if (typeof timeEl.setAttribute === 'function') {
        const prefix = [st.solarTerm, st.short].filter(Boolean).join(' · ');
        timeEl.setAttribute('title', prefix ? (prefix + ' · ' + txt) : txt);
      }
    }
  }

  function syncDestUi() {
    rows.forEach(function (row, key) {
      row.li.classList.toggle('is-dest', key === state.destId);
    });
    if (destEl) {
      destEl.textContent = state.destId
        ? byId.get(state.destId).name
        : (state.customDest ? state.customDest.name : '未定');
    }
  }

  function toggleDest(id) {
    const nextId = state.destId === id ? null : id;
    if (nextId && isCaveSealed()) {
      const targetPoi = byId.get(nextId);
      if (targetPoi && targetPoi.z < valleySplitZ) {
        state.sealedNotice = true;
        updateNote();
        if (state.open) drawMap(performance.now());
        return;
      }
    }
    state.destId = nextId;
    state.customDest = null;
    if (nextId && state.open && state.zoom > 1.05) {
      const targetPoi = byId.get(nextId);
      if (targetPoi) {
        state.viewCx = targetPoi.x;
        state.viewCz = targetPoi.z;
        clampViewCenter();
      }
    }
    syncDestUi();
    updateNote();
    state.miniDirty = true;
    if (!state.open) drawMini();
    else drawMap(performance.now());
  }

  function setCustomDest(wx, wz, meta = null) {
    if (isCaveSealed() && wz < valleySplitZ) {
      state.sealedNotice = true;
      updateNote();
      if (state.open) drawMap(performance.now());
      return;
    }
    if (!state.valleyUnveiled && wz < valleySplitZ && !meta?.allowBeforeUnveil) return;
    state.destId = null;
    state.customDest = {
      id: meta?.id || 'custom-pin',
      name: meta?.name || (regionAt(wx, wz) + ' · 闲印'),
      x: Math.round(wx * 10) / 10,
      z: Math.round(wz * 10) / 10,
      poem: meta?.poem || '信步寻幽，随印所往',
    };
    syncDestUi();
    updateNote();
    state.miniDirty = true;
    if (!state.open) drawMini();
    else drawMap(performance.now());
  }

  function clearCustomDest() {
    if (!state.customDest) return;
    state.customDest = null;
    syncDestUi();
    updateNote();
    state.miniDirty = true;
    if (!state.open) drawMini();
    else drawMap(performance.now());
  }

  // ---- 开合 ----

  function loop() {
    state.raf = requestAnimationFrame(function (now) {
      state.raf = 0;
      if (!state.open) return;
      const dt = state.prev ? Math.min(0.1, (now - state.prev) / 1000) : 0.016;
      state.prev = now;
      state.t += dt;
      if (now - state.lastDraw >= 42) {
        state.lastDraw = now;
        drawMap(now);
      }
      loop();
    });
  }

  function open() {
    if (state.open) return;
    state.open = true;
    player.clearInput();
    state.wasLocked = document.pointerLockElement === src.canvas;
    if (document.pointerLockElement) document.exitPointerLock();
    document.body?.classList?.add('map-open');
    mapEl?.classList?.add('open');
    mapEl?.setAttribute('aria-hidden', 'false');
    measure();
    ensureBase(state.geomW, dprOf());
    const pose = resolvePose();
    state.region = regionAt(pose.x, pose.z);
    if (regionEl) regionEl.textContent = state.region;
    updateCount();
    syncDestUi();
    syncTimeUi();
    syncToolsUi();
    hideScrollCard();
    updateNote();
    drawMini();
    state.prev = 0;
    state.lastDraw = 0;
    drawMap(performance.now());
    const hintNode = mapEl?.querySelector?.('.map__hint');
    if (hintNode) {
      if (mapHintDefaultHtml === null) mapHintDefaultHtml = hintNode.innerHTML;
      if (document.body?.classList?.contains?.('touch-active')) {
        hintNode.textContent = '点地名即往 · 双指缩放 · 轻点空白落闲印';
      } else if (mapHintDefaultHtml !== null) {
        hintNode.innerHTML = mapHintDefaultHtml;
      }
    }
    loop();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    dragActive = false;
    dragMoved = false;
    pinchActive = false;
    state.hoverScroll = null;
    state.hoverWinterSeal = null;
    hideScrollCard();
    player.clearInput();
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    state.prev = 0;
    // Relinquish oversized 2400px full-map rasters when closing M so background minimap
    // blending stays inside GPU texture cache (~16MB) instead of CPU software fallback.
    if (state.base && state.base.w > cfg.design) {
      ensureBase(cfg.design, 1);
      drawMini();
    }
    mapEl?.classList?.remove('open');
    mapEl?.setAttribute('aria-hidden', 'true');
    document.body?.classList?.remove('map-open');
    setHover(null);
    if (state.wasLocked && src.canvas) {
      state.wasLocked = false;
      try {
        const p = src.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (err) {
        // 浏览器拒绝时保持未锁定
      }
    }
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function resize() {
    if (!state.open) return;
    measure();
    ensureBase(state.geomW, dprOf());
    drawMap(performance.now());
    drawMini();
  }

  // ---- 交互 ----

  function canvasPoint(event) {
    if (!canvasEl || !state.geomW || !state.geomH) return null;
    if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
    const rect = canvasEl.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      mx: (event.clientX - rect.left) * state.geomW / rect.width,
      my: (event.clientY - rect.top) * state.geomH / rect.height,
    };
  }

  function hitPoiAt(mx, my, p) {
    const sealed = isCaveSealed();
    const hitR = lastInputCoarse ? 22 : 13;
    let best = null;
    let bd = hitR * hitR;
    for (let i = 0; i < allPois.length; i++) {
      const poi = allPois[i];
      const visited = state.visited.has(poi.id);
      if (poi.z < valleySplitZ && ((!state.valleyUnveiled && !visited) || sealed)) continue;
      const bx = poi.badge ? poi.x + poi.badge[0] : poi.x;
      const bz = poi.badge ? poi.z + poi.badge[1] : poi.z;
      const dx = mx - p.px(bx, bz);
      const dy = my - p.py(bx, bz);
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = poi;
      }
    }
    return best;
  }

  function hitPoi(event) {
    if (!state.base || !state.geomW) return null;
    const pt = canvasPoint(event);
    if (!pt) return null;
    return hitPoiAt(pt.mx, pt.my, viewProjection(state.geomW, state.geomH));
  }

  function hitScrollAt(mx, my) {
    const hitR = lastInputCoarse ? 20 : 12;
    let best = null;
    let bd = hitR * hitR;
    for (let i = 0; i < visibleScrollMarks.length; i++) {
      const m = visibleScrollMarks[i];
      const dx = mx - m.sx;
      const dy = my - m.sy;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = m.item;
      }
    }
    return best;
  }

  function hitWinterSealAt(mx, my) {
    const hitR = lastInputCoarse ? 22 : 14;
    let best = null;
    let bd = hitR * hitR;
    for (let i = 0; i < visibleWinterSeals.length; i++) {
      const m = visibleWinterSeals[i];
      const dx = mx - m.sx;
      const dy = my - m.sy;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  function hitWildsEggAt(mx, my) {
    const hitR = lastInputCoarse ? 22 : 14;
    let best = null;
    let bd = hitR * hitR;
    for (let i = 0; i < visibleWildsEggMarks.length; i++) {
      const m = visibleWildsEggMarks[i];
      const dx = mx - m.sx;
      const dy = my - m.sy;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  function hitQuestMarkAt(mx, my) {
    const hitR = lastInputCoarse ? 22 : 14;
    let best = null;
    let bd = hitR * hitR;
    for (let i = 0; i < visibleQuestMarks.length; i++) {
      const m = visibleQuestMarks[i];
      const dx = mx - m.sx;
      const dy = my - m.sy;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  function hitCustomAt(mx, my, p) {
    const cd = state.customDest;
    if (!cd) return false;
    const hitR = lastInputCoarse ? 22 : 14;
    const dx = mx - p.px(cd.x, cd.z);
    const dy = my - p.py(cd.x, cd.z);
    return dx * dx + dy * dy <= hitR * hitR;
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        !isEditableTarget(e.target) &&
        !isModalBusy(document, { ignore: 'map-open' })) {
      e.preventDefault();
      toggle();
      return;
    }
    if (state.open && e.code === 'Digit0' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      applyZoomAt(1, state.geomW * 0.5, state.geomH * 0.5);
      return;
    }
    if (e.code === 'Escape' && state.open) {
      if (scrollCardEl && !scrollCardEl.hidden) {
        hideScrollCard();
      } else {
        close();
      }
    }
  }

  function onCanvasDown(e) {
    if (!state.open || (e.button !== undefined && e.button !== 0)) return;
    if (!Number.isFinite(e?.clientX) || !Number.isFinite(e?.clientY)) return;
    dragActive = state.zoom > 1.01;
    dragMoved = false;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    if (dragActive) canvasEl.style.cursor = 'grabbing';
  }

  function onCanvasUp() {
    if (!dragActive) return;
    dragActive = false;
    if (canvasEl) canvasEl.style.cursor = state.zoom > 1.01 ? 'grab' : 'default';
  }

  function onCanvasMove(e) {
    if (dragActive && state.open && state.zoom > 1.01 && Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY)) {
      const dxPx = e.clientX - dragLastX;
      const dyPx = e.clientY - dragLastY;
      if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) dragMoved = true;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      if (state.geomW > 0 && state.geomH > 0) {
        const visZ = spanZ / state.zoom;
        const visX = spanX / state.zoom;
        state.viewCz -= (dxPx / state.geomW) * visZ;
        state.viewCx += (dyPx / state.geomH) * visX;
        clampViewCenter();
        drawMap(performance.now());
      }
      return;
    }
    const pt = canvasPoint(e);
    if (!pt) {
      setHover(null);
      return;
    }
    const p = viewProjection(state.geomW, state.geomH);
    const poi = hitPoiAt(pt.mx, pt.my, p);
    const scrollItem = poi ? null : hitScrollAt(pt.mx, pt.my);
    const winterSeal = (poi || scrollItem) ? null : hitWinterSealAt(pt.mx, pt.my);
    const wildsEgg = (poi || scrollItem || winterSeal) ? null : hitWildsEggAt(pt.mx, pt.my);
    const questMark = (poi || scrollItem || winterSeal || wildsEgg) ? null : hitQuestMarkAt(pt.mx, pt.my);
    const prevScroll = state.hoverScroll;
    const prevWinter = state.hoverWinterSeal;
    const prevWildsEgg = state.hoverWildsEgg;
    const prevQuestMark = state.hoverQuestMark;
    state.hoverScroll = scrollItem;
    state.hoverWinterSeal = winterSeal;
    state.hoverWildsEgg = wildsEgg;
    state.hoverQuestMark = questMark;
    if (poi) {
      setHover(poi.id);
    } else {
      if (state.hoverId) setHover(null);
      if (prevScroll !== scrollItem || prevWinter !== winterSeal || prevWildsEgg !== wildsEgg || prevQuestMark !== questMark) {
        updateNote();
        if (state.open) drawMap(performance.now());
      }
    }
    const customHit = !poi && !scrollItem && !winterSeal && !wildsEgg && !questMark && hitCustomAt(pt.mx, pt.my, p);
    canvasEl.style.cursor = (poi || scrollItem || winterSeal || wildsEgg || questMark || customHit)
      ? 'pointer'
      : (state.zoom > 1.01 ? 'grab' : 'default');
  }

  function onCanvasClick(e) {
    if (performance.now() < touchSuppressClickUntil) return;
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    const pt = canvasPoint(e);
    if (!pt || !state.base) return;
    const p = viewProjection(state.geomW, state.geomH);
    const poi = hitPoiAt(pt.mx, pt.my, p);
    if (poi) {
      toggleDest(poi.id);
      return;
    }
    const scrollItem = hitScrollAt(pt.mx, pt.my);
    if (scrollItem) {
      showScrollCard(scrollItem);
      state.hoverScroll = scrollItem;
      updateNote();
      return;
    }
    const winterSeal = hitWinterSealAt(pt.mx, pt.my);
    if (winterSeal) {
      if (state.customDest && state.customDest.id === winterSeal.id) {
        clearCustomDest();
      } else {
        setCustomDest(winterSeal.x, winterSeal.z, {
          id: winterSeal.id,
          name: winterSeal.label,
          poem: winterSeal.poem
        });
      }
      return;
    }
    const wildsEgg = hitWildsEggAt(pt.mx, pt.my);
    if (wildsEgg) {
      if (state.customDest && state.customDest.id === wildsEgg.id) {
        clearCustomDest();
      } else {
        setCustomDest(wildsEgg.x, wildsEgg.z, {
          id: wildsEgg.id,
          name: wildsEgg.discovered ? wildsEgg.name : '山野秘踪',
          poem: wildsEgg.discovered ? wildsEgg.poem : wildsEgg.rumor
        });
      }
      return;
    }
    const questMark = hitQuestMarkAt(pt.mx, pt.my);
    if (questMark) {
      if (typeof runtime.questSystem?.toggleWayfinder === 'function') {
        runtime.questSystem.toggleWayfinder(questMark.questId);
      } else if (state.customDest && state.customDest.id === questMark.id) {
        clearCustomDest();
      } else {
        setCustomDest(questMark.x, questMark.z, {
          id: questMark.id,
          name: questMark.title,
          poem: questMark.subtitle
        });
      }
      updateNote();
      if (state.open) drawMap(performance.now());
      return;
    }
    if (hitCustomAt(pt.mx, pt.my, p)) {
      clearCustomDest();
      return;
    }
    const wp = unprojectScreen(p, pt.mx, pt.my);
    if (wp.x >= extent.x[0] && wp.x <= extent.x[1] && wp.z >= extent.z[0] && wp.z <= extent.z[1]) {
      setCustomDest(wp.x, wp.z);
    }
  }

  function onCanvasWheel(e) {
    if (!state.open || !state.base) return;
    e.preventDefault?.();
    const pt = canvasPoint(e);
    const mx = pt ? pt.mx : state.geomW * 0.5;
    const my = pt ? pt.my : state.geomH * 0.5;
    const factor = e.deltaY < 0 ? (1 + zoomWheelStep) : 1 / (1 + zoomWheelStep);
    applyZoomAt(state.zoom * factor, mx, my);
  }

  function onCanvasDblClick() {
    if (!state.open) return;
    applyZoomAt(1, state.geomW * 0.5, state.geomH * 0.5);
  }

  function onCanvasLeave() {
    dragActive = false;
    state.hoverScroll = null;
    state.hoverWinterSeal = null;
    state.hoverWildsEgg = null;
    state.hoverQuestMark = null;
    setHover(null);
  }

  function onCanvasTouchStart(e) {
    if (!state.open || !state.base) return;
    lastInputCoarse = true;
    const touches = e.touches || e.changedTouches;
    if (!touches || !touches.length) return;
    if (touches.length >= 2) {
      e.preventDefault?.();
      const t0 = touches[0];
      const t1 = touches[1];
      pinchActive = true;
      dragActive = false;
      dragMoved = true;
      pinchStartDist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      pinchStartZoom = state.zoom;
      pinchLastMidX = (t0.clientX + t1.clientX) * 0.5;
      pinchLastMidY = (t0.clientY + t1.clientY) * 0.5;
      touchSuppressClickUntil = performance.now() + 400;
      return;
    }
    const t = touches[0];
    if (!Number.isFinite(t?.clientX) || !Number.isFinite(t?.clientY)) return;
    pinchActive = false;
    dragActive = state.zoom > 1.01;
    dragMoved = false;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    dragLastX = t.clientX;
    dragLastY = t.clientY;
    if (performance.now() - lastTapTime >= 320) {
      prevCustomDestBeforeTap = state.customDest ? { ...state.customDest } : null;
    }
  }

  function onCanvasTouchMove(e) {
    if (!state.open || !state.base) return;
    const touches = e.touches || e.changedTouches;
    if (!touches || !touches.length) return;
    if (touches.length >= 2) {
      e.preventDefault?.();
      const t0 = touches[0];
      const t1 = touches[1];
      const curDist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const midX = (t0.clientX + t1.clientX) * 0.5;
      const midY = (t0.clientY + t1.clientY) * 0.5;
      if (!pinchActive) {
        pinchActive = true;
        dragActive = false;
        pinchStartDist = curDist;
        pinchStartZoom = state.zoom;
        pinchLastMidX = midX;
        pinchLastMidY = midY;
      } else {
        const dxPx = midX - pinchLastMidX;
        const dyPx = midY - pinchLastMidY;
        pinchLastMidX = midX;
        pinchLastMidY = midY;
        if (state.geomW > 0 && state.geomH > 0 && state.zoom > 1.01) {
          const visZ = spanZ / state.zoom;
          const visX = spanX / state.zoom;
          state.viewCz -= (dxPx / state.geomW) * visZ;
          state.viewCx += (dyPx / state.geomH) * visX;
          clampViewCenter();
        }
        const pt = canvasPoint({ clientX: midX, clientY: midY });
        const mx = pt ? pt.mx : state.geomW * 0.5;
        const my = pt ? pt.my : state.geomH * 0.5;
        applyZoomAt(pinchStartZoom * (curDist / pinchStartDist), mx, my);
      }
      dragMoved = true;
      touchSuppressClickUntil = performance.now() + 400;
      return;
    }
    if (pinchActive) return;
    const t = touches[0];
    if (!t || !Number.isFinite(t.clientX) || !Number.isFinite(t.clientY)) return;
    if (dragActive && state.zoom > 1.01) {
      const distFromStart = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY);
      if (distFromStart > 6) dragMoved = true;
      if (dragMoved) {
        e.preventDefault?.();
        const dxPx = t.clientX - dragLastX;
        const dyPx = t.clientY - dragLastY;
        if (state.geomW > 0 && state.geomH > 0) {
          const visZ = spanZ / state.zoom;
          const visX = spanX / state.zoom;
          state.viewCz -= (dxPx / state.geomW) * visZ;
          state.viewCx += (dyPx / state.geomH) * visX;
          clampViewCenter();
          drawMap(performance.now());
        }
        touchSuppressClickUntil = performance.now() + 360;
      }
      dragLastX = t.clientX;
      dragLastY = t.clientY;
    }
  }

  function onCanvasTouchEnd(e) {
    const remaining = e.touches?.length ?? 0;
    if (pinchActive) {
      e.preventDefault?.();
      touchSuppressClickUntil = performance.now() + 400;
      if (remaining === 0) {
        pinchActive = false;
        dragActive = false;
        dragMoved = false;
      }
      return;
    }
    if (dragMoved) {
      e.preventDefault?.();
      touchSuppressClickUntil = performance.now() + 360;
      if (remaining === 0) {
        dragActive = false;
        dragMoved = false;
      }
      return;
    }
    if (remaining === 0) {
      dragActive = false;
      const t = e.changedTouches?.[0];
      if (!t || !state.open || !state.base) return;
      const now = performance.now();
      if (lastTapTime >= 0 && now - lastTapTime < 300 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 28) {
        e.preventDefault?.();
        touchSuppressClickUntil = now + 400;
        lastTapTime = -1000;
        // Double-tap zooms cleanly without leaving an accidental custom pin from tap 1
        if (prevCustomDestBeforeTap === null && state.customDest) {
          clearCustomDest();
        }
        const pt = canvasPoint(t);
        const mx = pt ? pt.mx : state.geomW * 0.5;
        const my = pt ? pt.my : state.geomH * 0.5;
        applyZoomAt(state.zoom > 1.2 ? 1 : 2.1, mx, my);
        return;
      }
      lastTapTime = now;
      lastTapX = t.clientX;
      lastTapY = t.clientY;
    }
  }

  function onMiniClick(e) {
    if (miniEl && Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY) && typeof miniEl.getBoundingClientRect === 'function') {
      const rect = miniEl.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        if (cx >= 0 && cx <= 30 && cy >= 0 && cy <= 30) {
          e.stopPropagation?.();
          state.miniRotate = !state.miniRotate;
          state.miniDirty = true;
          drawMini();
          return;
        }
      }
    }
    open();
  }

  function onCloseClick(e) {
    e.preventDefault();
    close();
  }

  function onScrimClick(e) {
    if (e.target === mapEl) close();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mouseup', onCanvasUp);
  if (miniEl) miniEl.addEventListener('click', onMiniClick);
  if (closeEl) closeEl.addEventListener('click', onCloseClick);
  if (mapEl) mapEl.addEventListener('click', onScrimClick);
  canvasEl.addEventListener('mousemove', onCanvasMove);
  canvasEl.addEventListener('click', onCanvasClick);
  canvasEl.addEventListener('mouseleave', onCanvasLeave);
  canvasEl.addEventListener('mousedown', onCanvasDown);
  canvasEl.addEventListener('mouseup', onCanvasUp);
  canvasEl.addEventListener('wheel', onCanvasWheel, { passive: false });
  canvasEl.addEventListener('dblclick', onCanvasDblClick);
  canvasEl.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
  canvasEl.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
  canvasEl.addEventListener('touchend', onCanvasTouchEnd, { passive: false });
  canvasEl.addEventListener('touchcancel', onCanvasTouchEnd, { passive: false });

  state.miniDirty = true;

  return {
    bindRuntime: function (refs) {
      if (!refs || typeof refs !== 'object') return;
      if (refs.godFlight) runtime.godFlight = refs.godFlight;
      if (refs.riverSkiff) runtime.riverSkiff = refs.riverSkiff;
      if (refs.act3Finale) runtime.act3Finale = refs.act3Finale;
      if (refs.phenology) runtime.phenology = refs.phenology;
      if (refs.scrollStudio) runtime.scrollStudio = refs.scrollStudio;
      if (refs.oxPlowing) runtime.oxPlowing = refs.oxPlowing;
      if (refs.worldClock) runtime.worldClock = refs.worldClock;
      if (refs.wulingOutskirts) runtime.wulingOutskirts = refs.wulingOutskirts;
      if (refs.questSystem) runtime.questSystem = refs.questSystem;
      if (refs.wildsEasterEggs) {
        runtime.wildsEasterEggs = refs.wildsEasterEggs;
        if (state.discoveredWildsEggs.size > 0) {
          runtime.wildsEasterEggs.hydrateDiscovered?.([...state.discoveredWildsEggs]);
        }
      }
      syncTimeUi();
      state.miniDirty = true;
    },
    markWildsEggDiscovered: markWildsEggDiscovered,
    setShowWildsClues: setShowWildsClues,
    setPhenology: function (phenologyId) {
      const changed = appearance.setPhenology(phenologyId, mapExpansion.phenology);
      currentPhenologyId = appearance.getStats().phenologyId;
      if (!changed) return false;
      releaseBase();
      pal = appearance.palette;
      applyAppearanceCss();
      state.miniDirty = true;
      state.miniTimer = 0;
      if (state.open) {
        ensureBase(state.geomW, dprOf());
        drawMap(performance.now());
      }
      return true;
    },
    // Store only: integration may pass dt, but update(dt) is the sole blend clock.
    setTimeAppearance: function (timeId, dt, weatherId) {
      if (timeId && timeId !== lastTargetTimeId) {
        lastTargetTimeId = timeId;
        immediateAppearanceDraw = true;
      }
      appearance.setTarget(timeId, dt, weatherId);
    },
    update: function (dt) {
      if (appearance.update(dt)) {
        pal = appearance.palette;
        applyAppearanceCss();
        state.miniDirty = true;
        const st = appearance.getStats();
        const settled = st.weights.every((v, i) => Math.abs(v - st.target[i]) < 1e-6);
        if (immediateAppearanceDraw || settled) {
          immediateAppearanceDraw = false;
          state.miniTimer = 0;
        }
        state.lastDraw = 0;
      }
      const st = resolvePose();
      updateRegion(st.x, st.z);
      syncTimeUi();

      const sealed = isCaveSealed();
      if (sealed) {
        let destCleared = false;
        if (state.destId) {
          const dp = byId.get(state.destId);
          if (dp && dp.z < valleySplitZ) {
            state.destId = null;
            destCleared = true;
          }
        }
        if (state.customDest && state.customDest.z < valleySplitZ) {
          state.customDest = null;
          destCleared = true;
        }
        if (destCleared) {
          syncDestUi();
          updateNote();
          state.miniDirty = true;
        }
      }

      const prevValleyUnveiled = state.valleyUnveiled;
      if (!st.flying) {
        let fogChanged = false;
        if (!state.valleyUnveiled && st.z < -30) {
          state.valleyUnveiled = true;
          fogChanged = true;
        }
        if (state.valleyUnveiled && st.z < valleySplitZ + 12) {
          if (markExplored(st.x, st.z, revealRadius)) fogChanged = true;
        }
        let found = false;
        for (let i = 0; i < allPois.length; i++) {
          const poi = allPois[i];
          const dx = st.x - poi.x;
          const dz = st.z - poi.z;
          if (waitForExit.has(poi.id)) {
            if (dx * dx + dz * dz > poi.reveal * poi.reveal) waitForExit.delete(poi.id);
            continue;
          }
          if (state.visited.has(poi.id)) continue;
          if (dx * dx + dz * dz <= poi.reveal * poi.reveal) {
            state.visited.add(poi.id);
            if (poi.z < valleySplitZ) state.valleyUnveiled = true;
            if (markExplored(poi.x, poi.z, Math.max(revealRadius, (poi.reveal || 24) + 18))) fogChanged = true;
            if (src.onVisit) src.onVisit(poi);
            markRow(poi.id);
            if (state.initialised) showToast(poi.name, false);
            found = true;
          }
        }
        if (found) {
          updateCount();
          if (state.visited.size >= allPois.length && state.initialised) {
            setTimeout(function () {
              showToast('桃源已尽览', true);
            }, 900);
          }
          state.miniDirty = true;
        }
        if (fogChanged || found) saveFog();
      }
      if (state.valleyUnveiled !== prevValleyUnveiled) {
        syncToolsUi();
        if (state.open) drawMap(performance.now());
      }
      if (!state.initialised) {
        state.initialised = true;
        updateCount();
      }
      state.miniTimer -= dt;
      if (state.miniTimer <= 0) {
        state.miniTimer = state.miniDirty ? 0.085 : 0.14;
        state.miniDirty = false;
        drawMini();
      }
    },
    clearVisited: function () {
      state.visited.clear();
      state.discoveredWildsEggs.clear();
      state.showWildsClues = false;
      waitForExit.clear();
      const st = resolvePose();
      allPois.forEach(function (poi) {
        const dx = st.x - poi.x;
        const dz = st.z - poi.z;
        if (dx * dx + dz * dz <= poi.reveal * poi.reveal) waitForExit.add(poi.id);
      });
      rows.forEach(function (row) { row.li.classList.remove('is-visited'); });
      explored.fill(0);
      state.valleyUnveiled = !isMainWorld || (!st.flying && st.z < -30);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(MAP_STORAGE_KEY); } catch (err) {}
      }
      updateCount();
      syncToolsUi();
      state.miniDirty = true;
    },
    open: open,
    close: close,
    toggle: toggle,
    resize: resize,
    isOpen: function () {
      return state.open;
    },
    getDestination: function () {
      if (state.destId && byId.has(state.destId)) {
        const poi = byId.get(state.destId);
        return { id: poi.id, name: poi.name, x: poi.x, z: poi.z, poem: poi.poem || '' };
      }
      if (state.customDest) {
        return { ...state.customDest };
      }
      return null;
    },
    setDestination: function (id) {
      if (!id) {
        state.customDest = null;
        if (state.destId) toggleDest(state.destId);
        else {
          syncDestUi();
          updateNote();
          state.miniDirty = true;
          if (!state.open) drawMini();
          else drawMap(performance.now());
        }
      } else if (byId.has(id) && state.destId !== id) {
        toggleDest(id);
      }
    },
    setCustomDest: setCustomDest,
    clearCustomDest: clearCustomDest,
    get valleyUnveiled() { return state.valleyUnveiled; },
    get caveSealed() { return isCaveSealed(); },
    getStats: function () {
      return {
        pois: allPois.length,
        extent: { x: extent.x.slice(), z: extent.z.slice() },
        visited: state.visited.size,
        dest: state.destId || (state.customDest ? state.customDest.id : null),
        region: state.region,
        open: state.open,
        valleyUnveiled: state.valleyUnveiled,
        zoom: Math.round(state.zoom * 100) / 100,
        miniMode: state.miniRotate ? 'heading' : 'scroll',
        caveSealed: isCaveSealed(),
        scrollMarks: lastScrollMarksCount,
        winterSeals: lastWinterSealsCount,
        wildsEggsFound: state.discoveredWildsEggs.size,
        wildsEggsTotal: getWildsEggSites().length,
        wildsEggMarks: lastWildsEggMarksCount,
        showWildsClues: state.showWildsClues,
        questMarks: lastQuestMarksCount,
        appearance: {
          ...appearance.getStats(),
          cacheRasters: state.base ? state.base.rasters.size : 0,
          rasterWidth: state.base ? state.base.w : 0,
          rasterHeight: state.base ? state.base.h : 0,
          rasterBytes: state.base ? state.base.w * state.base.h * 4 * state.base.rasters.size : 0,
          baseBakes: baseBakes,
        },
      };
    },
    dispose: function () {
      releaseBase();
      if (state.raf) cancelAnimationFrame(state.raf);
      if (state.toastTimer) clearTimeout(state.toastTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onCanvasUp);
      if (miniEl) miniEl.removeEventListener('click', onMiniClick);
      if (closeEl) closeEl.removeEventListener('click', onCloseClick);
      if (mapEl) mapEl.removeEventListener('click', onScrimClick);
      canvasEl.removeEventListener('mousemove', onCanvasMove);
      canvasEl.removeEventListener('click', onCanvasClick);
      canvasEl.removeEventListener('mouseleave', onCanvasLeave);
      canvasEl.removeEventListener('mousedown', onCanvasDown);
      canvasEl.removeEventListener('mouseup', onCanvasUp);
      canvasEl.removeEventListener('wheel', onCanvasWheel);
      canvasEl.removeEventListener('dblclick', onCanvasDblClick);
      canvasEl.removeEventListener('touchstart', onCanvasTouchStart);
      canvasEl.removeEventListener('touchmove', onCanvasTouchMove);
      canvasEl.removeEventListener('touchend', onCanvasTouchEnd);
      canvasEl.removeEventListener('touchcancel', onCanvasTouchEnd);
      if (scrollCardClose) scrollCardClose.removeEventListener('click', hideScrollCard);
      toolsEl?.remove?.();
      scrollCardEl?.remove?.();
      document.body?.classList?.remove('map-open');
    },
  };
}
