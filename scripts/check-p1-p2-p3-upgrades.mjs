import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MODAL_BODY_CLASSES,
  isVeilBlocking,
  isEditableTarget,
  isControlTarget,
  isModalBusy,
  isWorldFrozen
} from '../src/systems/modal-state.js';
import { createPortalVisibility } from '../src/bootstrap/portal-visibility.js';
import { registerExtraRegions } from '../src/bootstrap/world-registry.js';
import { createLazyScrollStudio } from '../src/systems/scroll-studio-lazy.js';
import { createLazyTouchControls, detectTouchViewport } from '../src/player/touch-controls-lazy.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';
import { createPoeticInteractions } from '../src/systems/poetic-interactions.js';

function createDomHarness() {
  const byId = new Map();
  const storageMap = new Map();
  const storage = {
    getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(String(k), String(v)); },
    removeItem: k => { storageMap.delete(String(k)); },
    clear: () => { storageMap.clear(); }
  };

  function makeClassList() {
    const set = new Set();
    return {
      set,
      add: (...xs) => xs.filter(Boolean).forEach(x => set.add(x)),
      remove: (...xs) => xs.filter(Boolean).forEach(x => set.delete(x)),
      toggle: (x, f) => {
        const next = f === undefined ? !set.has(x) : Boolean(f);
        if (next) set.add(x); else set.delete(x);
        return next;
      },
      contains: x => set.has(x)
    };
  }

  function makeMockCtx2d() {
    return {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '12px serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      save() {},
      restore() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      fill() {},
      stroke() {},
      drawImage() {},
      fillText() {},
      strokeText() {},
      measureText: t => ({ width: String(t || '').length * 8 }),
      translate() {},
      rotate() {},
      scale() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    };
  }

  function matchSel(el, sel) {
    if (!sel) return false;
    if (sel.includes(',')) {
      return sel.split(',').some(part => matchSel(el, part.trim()));
    }
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    if (sel === 'dialog[open]') return el.tagName === 'DIALOG' && (el.open || el.hasAttribute('open'));
    if (sel === '[aria-modal="true"]') return el.getAttribute('aria-modal') === 'true';
    return el.tagName === sel.toUpperCase();
  }

  function walkQuery(root, sel, all = false, out = []) {
    for (const c of root.children || []) {
      if (matchSel(c, sel)) {
        if (!all) return c;
        out.push(c);
      }
      const sub = walkQuery(c, sel, all, out);
      if (!all && sub) return sub;
    }
    return all ? out : null;
  }

  function makeEl(tag, initId = '') {
    let _id = String(initId || '');
    let _innerHtml = '';
    const classList = makeClassList();
    const style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; }
    };
    const isCanvas = String(tag).toLowerCase() === 'canvas';
    const el = {
      tagName: String(tag).toUpperCase(),
      get id() { return _id; },
      set id(v) {
        if (_id && byId.get(_id) === el) byId.delete(_id);
        _id = String(v || '');
        if (_id && el.isConnected) byId.set(_id, el);
      },
      get className() { return [...classList.set].join(' '); },
      set className(v) {
        classList.set.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => classList.set.add(c));
      },
      get innerHTML() { return _innerHtml; },
      set innerHTML(v) {
        _innerHtml = String(v || '');
        // Materialize tagged elements with id="..." so template-driven querySelector('#...') works
        for (const c of el.children) {
          if (c.id && byId.get(c.id) === c) byId.delete(c.id);
        }
        el.children = [];
        const re = /<([a-zA-Z0-9-]+)([^>]*\bid=["']([^"']+)["'][^>]*)>/g;
        let m;
        while ((m = re.exec(_innerHtml)) !== null) {
          const child = makeEl(m[1], m[3]);
          el.appendChild(child);
        }
      },
      classList,
      style,
      dataset: {},
      children: [],
      parentNode: null,
      listeners: new Map(),
      attributes: new Map(),
      hidden: false,
      open: false,
      value: '',
      title: '',
      textContent: '',
      isConnected: true,
      appendChild(c) {
        if (!c) return c;
        c.parentNode = this;
        c.isConnected = true;
        this.children.push(c);
        if (c.id) byId.set(c.id, c);
        return c;
      },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      replaceChildren(...cs) {
        this.children = [];
        cs.forEach(c => this.appendChild(c));
      },
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(x => x !== this);
        }
        const unregister = node => {
          if (node.id && byId.get(node.id) === node) byId.delete(node.id);
          node.isConnected = false;
          for (const ch of node.children || []) unregister(ch);
        };
        unregister(this);
      },
      removeChild(c) {
        this.children = this.children.filter(x => x !== c);
        if (c) c.parentNode = null;
        return c;
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      hasAttribute(k) { return this.attributes.has(k); },
      removeAttribute(k) { this.attributes.delete(k); },
      querySelector(sel) { return walkQuery(this, sel, false); },
      querySelectorAll(sel) { return walkQuery(this, sel, true, []); },
      addEventListener(ev, fn) {
        if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
        this.listeners.get(ev).add(fn);
      },
      removeEventListener(ev, fn) { this.listeners.get(ev)?.delete(fn); },
      dispatch(ev, payload = {}) {
        const list = [...(this.listeners.get(ev) || [])];
        for (const fn of list) {
          fn({ target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...payload });
        }
      },
      click() { this.dispatch('click'); },
      focus() { doc.activeElement = this; },
      showModal() { this.open = true; },
      close() {
        if (!this.open) return;
        this.open = false;
        this.dispatch('close');
      },
      closest() { return null; }
    };
    if (isCanvas) {
      el.width = 300;
      el.height = 150;
      el.clientWidth = 300;
      el.clientHeight = 150;
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 });
      el.getContext = () => makeMockCtx2d();
      el.toDataURL = () => 'data:image/png;base64,AA==';
    }
    if (_id) byId.set(_id, el);
    return el;
  }

  const head = makeEl('head');
  const htmlEl = makeEl('html');
  const body = makeEl('body');
  const canvas = makeEl('canvas', 'scene');
  canvas.requestPointerLock = () => {};
  const veil = makeEl('div', 'veil');
  veil.hidden = true;
  veil.classList.add('curtain-gone');
  body.classList.add('curtain-open');
  body.append(canvas, veil);

  const winListeners = new Map();
  const docListeners = new Map();
  const doc = {
    head,
    body,
    documentElement: htmlEl,
    hidden: false,
    visibilityState: 'visible',
    activeElement: body,
    pointerLockElement: null,
    _focus: true,
    hasFocus() { return this._focus; },
    exitPointerLock() { this.pointerLockElement = null; },
    getElementById: id => byId.get(id) || null,
    querySelector: sel => walkQuery(body, sel, false),
    querySelectorAll: sel => walkQuery(body, sel, true, []),
    createElement: tag => makeEl(tag),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { docListeners.get(ev)?.delete(fn); },
    dispatch(ev, payload = {}) {
      for (const fn of [...(docListeners.get(ev) || [])]) {
        fn({ target: body, preventDefault() {}, ...payload });
      }
    }
  };
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { maxTouchPoints: 0 },
    localStorage: storage,
    confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { winListeners.get(ev)?.delete(fn); },
    key(code, opts = {}) {
      let stopped = false;
      let prevented = false;
      const ev = {
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: opts.target || doc.body,
        preventDefault() { prevented = true; },
        stopImmediatePropagation() { stopped = true; }
      };
      for (const fn of [...(winListeners.get('keydown') || [])]) {
        fn(ev);
        if (stopped) break;
      }
      return { stopped, prevented };
    }
  };

  return { doc, win, canvas, veil, storage, makeEl };
}

// ============================================================================
// 1. P2.1: Unified modal-state.js guards
// ============================================================================
{
  assert.deepEqual(
    [...MODAL_BODY_CLASSES],
    ['map-open', 'field-guide-open', 'scroll-studio-open', 'traveler-guide-open', 'quest-open', 'ink-epilogue-open'],
    'MODAL_BODY_CLASSES covers all six modal body states'
  );

  const h = createDomHarness();
  assert.equal(isVeilBlocking(h.doc), false);
  assert.equal(isModalBusy(h.doc, { includeVeil: true }), false);

  for (const cls of MODAL_BODY_CLASSES) {
    h.doc.body.classList.add(cls);
    assert.equal(isModalBusy(h.doc), true, `${cls} blocks modals`);
    assert.equal(isModalBusy(h.doc, { ignore: cls }), false, `ignore skips ${cls}`);
    h.doc.body.classList.remove(cls);
  }

  // Mapped dialog ignore: ignoring 'traveler-guide-open' ignores open #traveler-guide dialog
  const tgDialog = h.makeEl('dialog', 'traveler-guide');
  tgDialog.open = true;
  h.doc.body.appendChild(tgDialog);
  assert.equal(isModalBusy(h.doc), true);
  assert.equal(isModalBusy(h.doc, { ignore: 'traveler-guide-open' }), false);
  tgDialog.open = false;

  // Cruise, UI hidden, Veil
  h.doc.body.classList.add('cruise-active');
  assert.equal(isModalBusy(h.doc, { includeCruise: false }), false);
  assert.equal(isModalBusy(h.doc, { includeCruise: true }), true);
  h.doc.body.classList.remove('cruise-active');

  h.doc.body.classList.add('ui-hidden');
  assert.equal(isModalBusy(h.doc, { includeUiHidden: false }), false);
  assert.equal(isModalBusy(h.doc, { includeUiHidden: true }), true);
  h.doc.body.classList.remove('ui-hidden');

  h.veil.hidden = false;
  h.veil.classList.remove('curtain-gone');
  h.veil.classList.add('ink-transition');
  assert.equal(isVeilBlocking(h.doc), true);
  assert.equal(isModalBusy(h.doc, { includeVeil: false }), false);
  assert.equal(isModalBusy(h.doc, { includeVeil: true }), true);
  h.veil.classList.remove('ink-transition');
  h.veil.classList.add('curtain-gone');
  h.veil.hidden = true;

  // Target classification & world freeze
  const inputTarget = { tagName: 'INPUT', isContentEditable: false };
  const btnTarget = { tagName: 'BUTTON', isContentEditable: false };
  const divWithBtnParent = { tagName: 'SPAN', isContentEditable: false, closest: sel => (sel.includes('button') ? btnTarget : null) };
  assert.equal(isEditableTarget(inputTarget), true);
  assert.equal(isEditableTarget(btnTarget), false);
  assert.equal(isControlTarget(btnTarget), true);
  assert.equal(isControlTarget(divWithBtnParent), true);

  assert.equal(isWorldFrozen(h.doc, { discovery: { isOpen: false } }), false);
  assert.equal(isWorldFrozen(h.doc, { discovery: { isOpen: true } }), true);
  h.doc.hidden = true;
  assert.equal(isWorldFrozen(h.doc, {}), true);
  h.doc.hidden = false;
  h.doc._focus = false;
  assert.equal(isWorldFrozen(h.doc, {}), true);
}

// ============================================================================
// 2. P2.2 & P2.3: portal-visibility.js + world-registry.js + main.js contracts
// ============================================================================
{
  const bucket = { blockers: [{ id: 'base-b' }], targets: [{ id: 'base-t' }] };
  registerExtraRegions(bucket, [
    null,
    { blockers: [{ id: 'b1' }, { id: 'b2' }], targets: [{ id: 't1' }] },
    { targets: [{ id: 't2' }] },
    { blockers: [{ id: 'b3' }] }
  ]);
  assert.deepEqual(bucket.blockers.map(x => x.id), ['base-b', 'b1', 'b2', 'b3']);
  assert.deepEqual(bucket.targets.map(x => x.id), ['base-t', 't1', 't2']);

  const intA = new THREE.Group();
  const extFish = new THREE.Group();
  const finale = new THREE.Group();
  let finaleVisible = false;

  const worldCfg = { cliff: { center: [0, 0], radius: 100, arcFrom: 0.55 } };
  const cliffCfg = { slit: { x: 0, z: 100 } };
  const pv = createPortalVisibility({
    world: worldCfg,
    cliff: cliffCfg,
    interiorGroups: [intA, intA, null],
    exteriorGroups: [extFish, extFish],
    conditionalExterior: [{ group: finale, isVisible: () => finaleVisible }]
  });

  assert.equal(pv.interiorGroups.length, 1, 'deduplicates interiorGroups');
  assert.equal(pv.exteriorGroups.length, 1, 'deduplicates exteriorGroups');
  assert.equal(pv.exteriorGroups[0], extFish);

  // Near exterior (far south + beyond radius + below 18m + away from slit) -> hideInterior = false, hideExterior = true
  const s1 = pv.update({ position: new THREE.Vector3(0, 2, 160) }, false);
  assert.equal(s1.hideExterior, true);
  assert.equal(s1.hideInterior, false);
  assert.equal(intA.visible, false);
  assert.equal(extFish.visible, true);
  assert.equal(finale.visible, false, 'conditionalExterior respects isVisible() === false');

  finaleVisible = true;
  const s2 = pv.update({ position: new THREE.Vector3(0, 2, 160) }, false);
  assert.equal(s2, s1, 'portalVisibility.update returns zero-alloc shared state object');
  assert.equal(finale.visible, true);

  // Deep interior -> hideInterior = true, hideExterior = false
  const s3 = pv.update({ position: new THREE.Vector3(0, 2, -50) }, false);
  assert.equal(s3.hideExterior, false);
  assert.equal(s3.hideInterior, true);
  assert.equal(intA.visible, true);
  assert.equal(extFish.visible, false);
  assert.equal(finale.visible, false);

  // Flying overrides portal culling, but still respects conditionalExterior isVisible
  finaleVisible = false;
  const s4 = pv.update({ position: new THREE.Vector3(0, 2, -50) }, true);
  assert.equal(s4.hideExterior, false);
  assert.equal(s4.hideInterior, false);
  assert.equal(intA.visible, true);
  assert.equal(extFish.visible, true);
  assert.equal(finale.visible, false);

  // Static contracts on src/main.js
  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(!/from ['"]\.\/systems\/scroll-studio\.js['"]/.test(mainSrc), 'main.js does not statically import scroll-studio.js');
  assert.ok(!/from ['"]\.\/player\/touch-controls\.js['"]/.test(mainSrc), 'main.js does not statically import touch-controls.js');
  assert.ok(mainSrc.includes("from './systems/scroll-studio-lazy.js'"), 'main.js imports scroll-studio-lazy.js');
  assert.ok(mainSrc.includes("from './player/touch-controls-lazy.js'"), 'main.js imports touch-controls-lazy.js');
  assert.ok(mainSrc.includes("if (n === 'deep-hollows-tea') return Math.min(base, 125 * mobileScale);"), 'deep-hollows-tea maxDistance cap wired in getMaxDistance');
}

// ============================================================================
// 3. P1: scroll-studio-lazy.js & touch-controls-lazy.js runtime lazy loading
// ============================================================================
{
  const h = createDomHarness();
  const dock = h.makeEl('nav', 'hud-top-dock');
  const journalEl = h.makeEl('dialog', 'journal');
  const journalTabs = h.makeEl('div', 'journal-tabs');
  journalTabs.className = 'journal__tabs';
  journalEl.appendChild(journalTabs);
  h.doc.body.append(dock, journalEl);

  const seedScrolls = [{ id: 's-init', title: '春水图', style: 'ink', format: 'handscroll', savedAt: 1000 }];
  h.storage.setItem('taohua.scrolls.v1', JSON.stringify(seedScrolls));

  let disposedScrollStudio = false;
  const lazyScroll = createLazyScrollStudio({
    canvas: h.canvas,
    player: { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, clearInput() {} },
    camera: new THREE.PerspectiveCamera(),
    sky: { timeId: 'day', rainIntensity: 0, snowIntensity: 0 },
    map: { isOpen: () => false, getStats: () => ({ region: '桃源', regionId: 'peach-village', visited: 1 }) },
    journal: { isOpen: () => false, getStats: () => ({ entries: 0, records: 0 }) },
    renderSceneNow: () => {},
    world: { terrain: { waterLevel: -1.2 }, village: { houses: [] } },
    doc: h.doc,
    win: h.win,
    storage: h.storage,
    idbFactory: null
  });

  assert.equal(lazyScroll.loaded, false, 'scrollStudio starts unloaded');
  assert.ok(h.doc.getElementById('scroll-open'), 'shell mounts #scroll-open');
  assert.ok(h.doc.getElementById('journal-tab-scrolls'), 'shell mounts #journal-tab-scrolls');
  assert.equal(h.doc.getElementById('journal-scrolls'), null, 'shell does NOT create #journal-scrolls eagerly');
  assert.equal(lazyScroll.getSavedScrolls().length, 1, 'getSavedScrolls reads taohua.scrolls.v1 synchronously before module load');
  assert.equal(lazyScroll.getStats().loaded, false);

  const opened = await lazyScroll.openCapture(false);
  assert.equal(lazyScroll.loaded, true, 'openCapture dynamically loads scroll-studio.js');
  assert.equal(opened, true, 'openCapture delegates to real scroll studio and opens dialog');
  assert.equal(lazyScroll.getStats().loaded, true);
  assert.ok(h.doc.getElementById('journal-scrolls'), 'real scroll-studio populates #journal-scrolls upon load');

  lazyScroll.dispose();
  assert.equal(lazyScroll.getStats().disposed, true);
  assert.equal(h.doc.getElementById('scroll-open'), null, 'dispose removes #scroll-open');
  disposedScrollStudio = true;
  assert.ok(disposedScrollStudio);

  // Desktop viewport -> detectTouchViewport is false -> lazy touch stays unloaded until touchstart
  assert.equal(detectTouchViewport(h.win), false);
  const lazyTouch = createLazyTouchControls({
    canvas: h.canvas,
    player: { state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, touchMove() {}, touchLook() {}, setTouchSprint() {}, triggerJump() {} },
    doc: h.doc,
    win: h.win
  });
  assert.equal(lazyTouch.loaded, false, 'touchControls stays unloaded on desktop initially');
  assert.equal(lazyTouch.getStats().loaded, false);

  h.doc.dispatch('touchstart');
  await lazyTouch.ensureLoaded();
  assert.equal(lazyTouch.loaded, true, 'touchstart triggers dynamic import of touch-controls.js');
  lazyTouch.dispose();
  assert.equal(lazyTouch.getStats().disposed, true);
}

// ============================================================================
// 4. P3: #tguide-god-flight & deepHollows / wildsEasterEggs poetic interactions
// ============================================================================
{
  const h = createDomHarness();
  let gfActive = false;
  let gfToggleCount = 0;
  const mockGf = {
    get active() { return gfActive; },
    toggle() {
      gfToggleCount++;
      gfActive = !gfActive;
      return gfActive;
    },
    exit() { gfActive = false; return true; }
  };

  const guide = createTravelerGuideAndCruise({
    camera: new THREE.PerspectiveCamera(),
    player: { state: { x: 0, y: 0, z: 0 }, clearInput() {} },
    canvas: h.canvas,
    getGodFlight: () => mockGf,
    doc: h.doc,
    win: h.win
  });

  const gfBtn = h.doc.getElementById('tguide-god-flight');
  assert.ok(gfBtn, '#tguide-god-flight mounted in traveler guide dialog');
  assert.equal(guide.openGuide(), true);
  assert.equal(gfBtn.textContent, '御风飞览（P）');

  gfBtn.click();
  assert.equal(gfToggleCount, 1);
  assert.equal(gfActive, true);
  assert.equal(guide.isGuideOpen(), false, 'clicking #tguide-god-flight closes guide dialog before entering flight');

  assert.equal(guide.openGuide(), true);
  assert.equal(gfBtn.textContent, '退出御风（P）', 'openGuide syncs #tguide-god-flight label when godFlight is active');
  gfBtn.click();
  assert.equal(gfToggleCount, 2);
  assert.equal(gfActive, false);

  guide.dispose();
  assert.equal(h.doc.getElementById('tguide-god-flight'), null, 'dispose cleans up #traveler-guide dialog');
}

{
  const h = createDomHarness();
  const noteEl = h.makeEl('div', 'mystery-note');
  h.doc.body.appendChild(noteEl);

  const playerState = {
    x: 55.65,
    y: 0,
    z: -293.65, // 2m north of cold-spring basin [55.65, -295.65], facing -z (yaw = 0)
    yaw: 0,
    pitch: -0.2,
    view: 'first',
    aboardSkiff: false,
    seated: false,
    godFlight: false
  };
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(playerState.x, 1.65, playerState.z);

  const deepHollows = {
    layout: {
      pools: [{ x: 55.65, z: -295.65, rx: 1.2, rz: 1.1 }],
      sanctuaries: {
        ancientAltar: { id: 'dh-altar', name: '深坞古坛', x: 18, z: -268 },
        secludedStudy: { id: 'dh-study', name: '冷泉幽斋', x: 60, z: -296 },
        teaTerrace: { id: 'dh-tea', name: '南坡茶畦', x: 46, z: -232 }
      }
    }
  };
  const wildsEasterEggs = {
    sites: [{ id: 'wilds-jade-echo-spring', name: '玉响泉', x: 22, y: 1.2, z: -284 }]
  };

  const pi = createPoeticInteractions({
    world: { terrain: { waterLevel: -1.2 }, stream: { halfWidth: 4.2 } },
    field: { sample: () => 0 },
    player: { state: playerState },
    camera: cam,
    sky: { windX: 0.2, windZ: 0.1, rainIntensity: 0 },
    deepHollows,
    wildsEasterEggs,
    doc: h.doc,
    win: h.win
  });

  // 1. Cold-spring stone basin waterside hit + launch
  const pick1 = pi.pickTarget(cam, {});
  assert.ok(pick1 && pick1.waterHit?.kind === 'pool', 'detects deepHollows cold-spring stone pool');
  const act1 = pi.interact(pick1);
  assert.equal(act1?.action, 'float-leaf');

  // Advance simulation past 0.55s watersideCooldown (update clamps dt to 0.05s)
  for (let i = 0; i < 15; i++) pi.update(0.05, 0.05 * (i + 1));

  // 2. Wilds jade-echo spring waterside hit + play
  playerState.x = 22;
  playerState.z = -281.8; // 2.2m north of [22, -284], facing -z
  cam.position.set(playerState.x, 1.65, playerState.z);
  const pick2 = pi.pickTarget(cam, {});
  assert.ok(pick2 && pick2.waterHit?.kind === 'pool', 'detects wilds-jade-echo-spring pool');
  const floatJade = pi.triggerWatersidePlay('float');
  assert.equal(floatJade?.action, 'float-leaf');
  assert.ok(Math.hypot(floatJade.x - 22, floatJade.z - (-284)) <= 2.2, 'float spawns inside jade-echo spring');

  // 3. Yellow-dog guide includes deepHollows.layout.sanctuaries destinations
  playerState.x = 60;
  playerState.z = -270; // ~38m south of teaTerrace [46,-232], ~26m from secludedStudy [60,-296], ~42m from ancientAltar [18,-268]
  const guided = pi.triggerChildDogGuide(true);
  assert.ok(
    ['深坞古坛', '冷泉幽斋', '南坡茶畦'].includes(guided?.targetName),
    `yellow-dog guide targets deepHollows sanctuary (got: ${guided?.targetName})`
  );

  pi.dispose();
  assert.equal(pi.getStats().disposed, true);
}

console.log('PASS p1/p2/p3 upgrades: modal-state, portal-visibility, world-registry, lazy scroll/touch, guide godFlight button, deepHollows poetic interactions');
