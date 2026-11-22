import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestSystem } from '../src/systems/quest-system.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';

const questsData = JSON.parse(readFileSync(new URL('../src/data/quests.json', import.meta.url), 'utf8'));
const questSrc = readFileSync(new URL('../src/systems/quest-system.js', import.meta.url), 'utf8');

// 0. Data & code hygiene contracts
assert.equal(questsData.storageKey, 'taohua.quests.v1');
assert.equal(questsData.main.steps.length, 8, 'main story defines 8 steps across 3 acts');
assert.equal(questsData.sides.length, 9, 'side quests cover 9 quests across 3 categories');
const cats = new Set(questsData.sides.map(q => q.category));
assert.deepEqual([...cats].sort(), ['lore', 'neighbor', 'season'], 'all 3 side categories present');
assert.ok(!/\bconsole\.log\s*\(/.test(questSrc), 'quest-system.js has no console.log');
assert.ok(!/\.getStats\s*(?:\?\.)?\s*\(/.test(questSrc), 'quest-system.js avoids calling getStats inside hot paths');

const jsonStr = JSON.stringify(questsData);
for (const banned of ['经验值', '金币', '奖励领取', '任务完成度', '%']) {
  assert.ok(!jsonStr.includes(banned), `quests.json excludes RPG/anxiety trope "${banned}"`);
}

// 1. Minimal headless DOM + Storage + Mock Runtime Harness
function createHarness() {
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
      miterLimit: 10,
      font: '12px serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      shadowColor: 'transparent',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      filter: 'none',
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
      arcTo() {},
      ellipse() {},
      rect() {},
      roundRect() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      fill() {},
      stroke() {},
      clip() {},
      translate() {},
      scale() {},
      rotate() {},
      setTransform() {},
      resetTransform() {},
      setLineDash() {},
      fillText() {},
      strokeText() {},
      measureText: t => ({ width: String(t || '').length * 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => ({}),
      createImageData: (w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      drawImage() {}
    };
  }

  function matchSel(el, sel) {
    if (!sel) return false;
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
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
        if (this.id && byId.get(this.id) === this) byId.delete(this.id);
        this.isConnected = false;
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      querySelector(sel) { return walkQuery(this, sel, false); },
      querySelectorAll(sel) { return walkQuery(this, sel, true, []); },
      addEventListener(ev, fn) {
        if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
        this.listeners.get(ev).add(fn);
      },
      removeEventListener(ev, fn) { this.listeners.get(ev)?.delete(fn); },
      dispatch(ev, payload = {}) {
        const list = [...(this.listeners.get(ev) || [])];
        for (const fn of list) fn({ target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...payload });
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
    exitPointerLock() { this.pointerLockElement = null; },
    getElementById: id => byId.get(id) || null,
    querySelector: sel => walkQuery(body, sel, false),
    querySelectorAll: sel => walkQuery(body, sel, true, []),
    createElement: tag => makeEl(tag),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { docListeners.get(ev)?.delete(fn); }
  };
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
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

  return { doc, win, canvas, storage, storageMap };
}

function makeMockWorld(h, extra = {}) {
  const firedClassics = new Set();
  const visitedPois = new Set();
  let dest = null;
  let valleyUnveiled = false;
  let phenologyId = 'spring';
  let godFlightActive = false;

  const player = {
    state: { x: 26, y: 0, z: 204, godFlight: false },
    clearInput() {}
  };
  const sky = {
    timeId: 'day',
    weatherId: 'clear',
    rainIntensity: 0,
    snowIntensity: 0,
    get phenologyId() { return phenologyId; }
  };
  const map = {
    get valleyUnveiled() { return valleyUnveiled; },
    get caveSealed() { return act3Finale.caveSealed; },
    getDestination: () => dest,
    setDestination(id) {
      dest = id ? { id, name: id, x: id === 'kou' ? 22 : -10, z: id === 'kou' ? 13.5 : 78 } : null;
    },
    setCustomDest(x, z, meta = {}) {
      dest = { id: meta.id || 'custom-pin', name: meta.name || 'custom', x, z };
    },
    clearCustomDest() { dest = null; },
    getStats: () => ({ valleyUnveiled, caveSealed: act3Finale.caveSealed })
  };
  const dialogue = {
    hasFired: id => firedClassics.has(id)
  };
  const act3Finale = {
    stage: 'idle',
    placedCount: 0,
    caveSealed: false,
    departFerryPos: { x: 13, z: 160 },
    getNextUnplacedMarker: () => ({ id: 'mark-cave', x: 19, z: 8, name: '洞口石堆竹标' })
  };
  const journal = {
    classics: () => [...firedClassics],
    visited: () => [...visitedPois],
    onEvent: null,
    onClear: null,
    isOpen: () => false
  };
  const easterEggs = {
    sites: [
      { id: 'qin-bamboo-slips', x: 26, z: -52 },
      { id: 'floating-wine-cup', x: 50, z: -150 },
      { id: 'camphor-hollow-brew', x: -6, z: -114 },
      { id: 'cloud-guqin-stone', x: 92, z: -172 },
      { id: 'peach-wind-tallies', x: 76, z: -188 },
      { id: 'moon-white-stag', x: -28, z: -178 }
    ]
  };
  const poeticInteractions = { pentatonicCount: 0 };
  const situationalRest = { currentSeatId: null };
  const mysteries = {
    interact(target) {
      return target ? { id: target.id || target.siteId, ok: true } : null;
    }
  };
  const plucks = [];
  const sound = {
    guqinPluck(_x, _z, noteIdx) { plucks.push(noteIdx); }
  };
  const villagerDialogue = createVillagerDialogue({
    sky,
    getPhenology: () => ({ currentId: phenologyId, getStats: () => ({ phenologyId }) }),
    doc: h.doc,
    win: h.win
  });

  const qs = createQuestSystem({
    player,
    canvas: h.canvas,
    sky,
    map,
    journal,
    dialogue,
    act3Finale,
    easterEggs,
    hospitalityFeast: { layout: { site: { x: 22, z: -60 } } },
    qinHanHomestead: { layout: { weaving: { x: 42, z: -120 }, carpentry: { x: 36, z: -136 }, hearth: { x: 38, z: -108 } } },
    waterworks: { layout: { wheels: [{ x: 112, z: -82 }] } },
    oxPlowing: { targets: [{ x: 56, z: -84 }] },
    poeticInteractions,
    situationalRest,
    villagerDialogue,
    mysteries,
    sound,
    getPhenology: () => ({ currentId: phenologyId }),
    getGodFlight: () => ({ active: godFlightActive }),
    getScrollStudio: extra.getScrollStudio || null,
    doc: h.doc,
    win: h.win,
    storage: h.storage
  });

  return {
    qs,
    player,
    sky,
    map,
    firedClassics,
    visitedPois,
    act3Finale,
    journal,
    poeticInteractions,
    situationalRest,
    mysteries,
    villagerDialogue,
    plucks,
    setValleyUnveiled(v) { valleyUnveiled = v; },
    setPhenology(p) { phenologyId = p; },
    setGodFlight(v) { godFlightActive = v; player.state.godFlight = v; }
  };
}

// 2. Test main quest progression & dynamic wayfinder
{
  const h = createHarness();
  const w = makeMockWorld(h);
  assert.equal(w.qs.getStats().mainStep, 0);

  // Wayfinder on main step 0 points to taolin
  assert.equal(w.qs.toggleWayfinder('main-taohuayuan'), true);
  assert.equal(w.map.getDestination()?.id, 'taolin');

  // Fire Act 1 & 2 classics
  w.firedClassics.add('peach-grove');
  w.journal.onEvent?.('classics', 'peach-grove');
  assert.equal(w.qs.getStats().mainStep, 1);
  assert.equal(w.map.getDestination()?.id, 'kou');

  w.firedClassics.add('cave-glimmer');
  w.journal.onEvent?.('classics', 'cave-glimmer');
  assert.equal(w.qs.getStats().mainStep, 2);

  w.setValleyUnveiled(true);
  w.player.state.z = -50;
  w.firedClassics.add('valley-open');
  w.journal.onEvent?.('classics', 'valley-open');
  w.firedClassics.add('village-gate');
  w.journal.onEvent?.('classics', 'village-gate');
  assert.equal(w.qs.getStats().mainStep, 4);

  // Feast dialogue advances to Act 3 marking
  w.firedClassics.add('feast-history');
  w.journal.onEvent?.('classics', 'feast-history');
  assert.equal(w.qs.getStats().mainStep, 5);

  // Act 3 marking -> prefect return -> lost -> epilogue
  w.act3Finale.stage = 'marking';
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  w.act3Finale.stage = 'returning';
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  assert.equal(w.qs.getStats().mainStep, 6);

  w.act3Finale.stage = 'lost';
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  assert.equal(w.qs.getStats().mainStep, 7);

  w.act3Finale.stage = 'epilogue';
  w.act3Finale.caveSealed = true;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  assert.equal(w.qs.getStats().mainCompleted, true);
  assert.equal(w.qs.getStats().mainStep, 8);

  // Sealed valley fallback redirects interior quest wayfinder to 武陵孤舟
  w.qs.toggleWayfinder('side-tea-message');
  assert.ok(w.map.getDestination()?.name.includes('孤舟'), 'sealed cave falls back wayfinder to 武陵孤舟');
  w.qs.dispose();
}

// 3. Test Villager Dialogue Quest Offer -> Accept -> Progress -> Turn-In
{
  const h = createHarness();
  const w = makeMockWorld(h);

  const greeterTarget = { kind: 'community', key: 'c_greeter', name: '村口施茶老丈', ref: { role: 'outskirt_greeter' } };
  const turn0 = w.villagerDialogue.beginOrAdvance(greeterTarget);
  assert.ok(turn0.replies.some(r => r.topic === '__quest__'), 'outskirt_greeter offers side-tea-message');
  const qIdx = turn0.replies.findIndex(r => r.topic === '__quest__');
  w.villagerDialogue.chooseReply(qIdx);
  assert.equal(w.qs.getState().sides['side-tea-message'].status, 'active', 'choosing quest reply accepts side quest');
  w.villagerDialogue.chooseReply(0); // close conversation cleanly

  // Talk to mountain tea host
  const teaHostTarget = { kind: 'community', key: 'c_teahost', name: '松风茶翁', ref: { role: 'mountain_tea_host' } };
  w.villagerDialogue.beginOrAdvance(teaHostTarget);
  w.villagerDialogue.chooseReply(0);
  w.villagerDialogue.chooseReply(0);
  assert.ok(w.qs.getState().sides['side-tea-message'].doneSteps.includes('visit-pine-tea'));

  // Return to outskirt greeter
  const retTurn = w.villagerDialogue.beginOrAdvance(greeterTarget);
  assert.equal(w.qs.getState().sides['side-tea-message'].status, 'completed');
  const turnInIdx = retTurn.replies.findIndex(r => r.topic === '__quest__');
  assert.ok(turnInIdx >= 0, 'completed quest offers turn-in dialogue');
  w.villagerDialogue.chooseReply(turnInIdx);
  assert.equal(w.qs.getState().sides['side-tea-message'].talkedComplete, true);
  w.qs.dispose();
}

// 4. Test Lore & Seasonal Side Quests + Storage Persistence + KeyQ / GodFlight Guard + Dispose
{
  const h = createHarness();
  const w = makeMockWorld(h);

  // Lore interactions via mysteries.interact
  for (const id of ['qin-bamboo-slips', 'borderland-qin-stele', 'ancient-qin-altar']) {
    w.mysteries.interact({ kind: 'mystery', id });
  }
  assert.equal(w.qs.getState().sides['side-qin-records'].status, 'completed');

  // Guqin + Stag
  w.poeticInteractions.pentatonicCount = 1;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  w.mysteries.interact({ kind: 'mystery', id: 'moon-white-stag' });
  assert.equal(w.qs.getState().sides['side-guqin-deer'].status, 'completed');

  // Seasonal quests
  w.setPhenology('spring');
  w.player.state.x = 56;
  w.player.state.z = -84;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  assert.equal(w.qs.getState().sides['side-spring-plow'].status, 'completed');

  w.sky.timeId = 'night';
  w.player.state.x = 38;
  w.player.state.z = -108;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  assert.equal(w.qs.getState().sides['side-night-fou'].status, 'completed');

  w.setPhenology('summer');
  w.player.state.x = 58;
  w.player.state.z = -130;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  w.setPhenology('autumn');
  w.player.state.x = 124.5;
  w.player.state.z = -170;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  w.setPhenology('winter');
  w.mysteries.interact({ kind: 'mystery', id: 'entrance-tea-shelter' });
  assert.equal(w.qs.getState().sides['side-four-seasons-tea'].status, 'completed');

  // KeyQ opens dialog, Escape closes; GodFlight ignores KeyQ
  assert.equal(w.qs.isOpen(), false);
  w.setGodFlight(true);
  h.win.key('KeyQ');
  assert.equal(w.qs.isOpen(), false, 'god-flight preserves Q for vertical descent');
  w.setGodFlight(false);
  h.win.key('KeyQ');
  assert.equal(w.qs.isOpen(), true, 'KeyQ opens quest scroll dialog');
  assert.equal(h.doc.body.classList.contains('quest-open'), true);
  h.win.key('Escape');
  assert.equal(w.qs.isOpen(), false);
  assert.equal(h.doc.body.classList.contains('quest-open'), false);

  // Storage persistence round-trip
  const savedRaw = h.storageMap.get('taohua.quests.v1');
  assert.ok(savedRaw && JSON.parse(savedRaw).sides['side-qin-records'].status === 'completed');

  // 300-frame zero-crash steady loop
  for (let i = 0; i < 300; i++) w.qs.update(0.016);

  // Dispose removes injected DOM & restores mysteries.interact
  w.qs.dispose();
  assert.equal(h.doc.getElementById('quest-open'), null);
  assert.equal(h.doc.getElementById('quest-tracker'), null);
  assert.equal(h.doc.getElementById('quest-dialog'), null);
  assert.equal(h.doc.getElementById('quest-system-styles'), null);
  assert.equal(w.mysteries._questWrapped, undefined);

  // Reloading from saved storage restores completed quests
  const w2 = makeMockWorld(h);
  assert.equal(w2.qs.getState().sides['side-qin-records'].status, 'completed');
  assert.equal(w2.qs.getState().sides['side-four-seasons-tea'].status, 'completed');
  w2.qs.dispose();
}

// 5. Scroll Seal Linkage + Shared Top Dock (#hud-top-dock) + Async Close Race Guard
{
  const h = createHarness();
  const dock = h.doc.createElement('nav');
  dock.id = 'hud-top-dock';
  h.doc.body.appendChild(dock);

  let ss = null;
  const w = makeMockWorld(h, { getScrollStudio: () => ss });
  ss = createScrollStudio({
    canvas: h.canvas,
    player: w.player,
    sky: w.sky,
    map: w.map,
    journal: w.journal,
    getQuestSystem: () => w.qs,
    renderSceneNow: () => {},
    doc: h.doc,
    win: h.win,
    storage: h.storage,
    idbFactory: null
  });
  const guide = createTravelerGuideAndCruise({
    camera: null,
    player: w.player,
    canvas: h.canvas,
    doc: h.doc,
    win: h.win
  });

  // Shared top dock mounting for #scroll-open, #guide-open, #quest-open
  const scrollBtn = h.doc.getElementById('scroll-open');
  const guideBtn = h.doc.getElementById('guide-open');
  const questBtn = h.doc.getElementById('quest-open');
  assert.ok(scrollBtn && guideBtn && questBtn, 'all dock buttons exist');
  assert.equal(scrollBtn.parentNode, dock, '#scroll-open mounts into #hud-top-dock');
  assert.equal(guideBtn.parentNode, dock, '#guide-open mounts into #hud-top-dock');
  assert.equal(questBtn.parentNode, dock, '#quest-open mounts into #hud-top-dock');

  // Initially zero earned seals -> quest seal bar stays hidden
  assert.deepEqual(w.qs.getEarnedSeals(), []);
  assert.deepEqual(ss.getAvailableQuestSeals(), []);
  assert.equal(ss.openCapture(false), true);
  assert.equal(h.doc.getElementById('scroll-quest-seals')?.hidden, true);
  assert.equal(ss.close(), true);

  // Unlock side-qin-records ("避秦旧铭") & side-guqin-deer ("琴韵霜鹿")
  for (const id of ['qin-bamboo-slips', 'borderland-qin-stele', 'ancient-qin-altar']) {
    w.mysteries.interact({ kind: 'mystery', id });
  }
  w.poeticInteractions.pentatonicCount = 1;
  for (let i = 0; i < 6; i++) w.qs.update(0.05);
  w.mysteries.interact({ kind: 'mystery', id: 'moon-white-stag' });

  const earnedSeals = w.qs.getEarnedSeals().map(s => s.seal);
  assert.ok(earnedSeals.includes('琴韵霜鹿'), 'earned seals include 琴韵霜鹿');
  assert.ok(earnedSeals.includes('避秦旧铭'), 'earned seals include 避秦旧铭');

  // Scroll studio displays clickable pills & stays bidirectionally synced
  assert.equal(ss.openCapture(false), true);
  assert.equal(ss.getAvailableQuestSeals().length, 2);
  const sealsRow = h.doc.getElementById('scroll-quest-seals');
  assert.equal(sealsRow?.hidden, false);
  const pills = sealsRow.querySelectorAll('.scroll-quest-seal');
  assert.equal(pills.length, 2);

  const deerPill = pills.find(p => p.dataset.seal === '琴韵霜鹿');
  const qinPill = pills.find(p => p.dataset.seal === '避秦旧铭');
  const sealInput = h.doc.getElementById('scroll-custom-seal');
  assert.ok(deerPill && qinPill && sealInput);

  deerPill.click();
  assert.equal(ss.getCustomInscription().seal, '琴韵霜鹿');
  assert.equal(sealInput.value, '琴韵霜鹿');
  assert.equal(deerPill.classList.contains('is-active'), true);
  assert.equal(deerPill.getAttribute('aria-pressed'), 'true');

  sealInput.value = '避秦旧铭';
  sealInput.dispatch('input');
  assert.equal(qinPill.classList.contains('is-active'), true);
  assert.equal(deerPill.classList.contains('is-active'), false);

  qinPill.click();
  assert.equal(ss.getCustomInscription().seal, '');
  assert.equal(sealInput.value, '');
  assert.equal(ss.close(), true);

  // "以此印留影" jump from quest seals panel + real-browser async <dialog>.close() race
  assert.equal(w.qs.open(), true);
  const questDialog = h.doc.getElementById('quest-dialog');
  const sealTabBtn = questDialog.querySelectorAll('.quest__tab').find(b => b.textContent.includes('印记'));
  assert.ok(sealTabBtn, 'seal tab button present');
  sealTabBtn.click();

  const cards = questDialog.querySelectorAll('.quest__seal-card');
  const deerCard = cards.find(c => c.querySelector('.quest__seal-stamp')?.textContent === '琴韵霜鹿');
  const useSealBtn = deerCard?.querySelector('.quest__btn');
  assert.ok(useSealBtn && useSealBtn.textContent === '以此印留影', '"以此印留影" button rendered on earned seal card');

  const origClose = questDialog.close;
  let fireAsyncClose = null;
  questDialog.close = () => {
    if (!questDialog.open) return;
    questDialog.open = false;
    fireAsyncClose = () => questDialog.dispatch('close');
  };

  useSealBtn.click();
  assert.equal(w.qs.isOpen(), false);
  assert.equal(h.doc.body.classList.contains('quest-open'), false, 'body.quest-open cleared synchronously before async close event');
  assert.equal(ss.isOpen(), true, 'scroll studio opens cleanly despite delayed close event');
  assert.equal(h.doc.body.classList.contains('scroll-studio-open'), true);
  assert.equal(ss.getCustomInscription().seal, '琴韵霜鹿');
  assert.equal(h.doc.getElementById('scroll-custom-seal')?.value, '琴韵霜鹿');
  assert.ok(h.doc.getElementById('scroll-status')?.textContent?.includes('琴韵霜鹿'), 'scroll studio displays seal handoff status hint');

  const scrollActive = h.doc.activeElement;
  assert.equal(scrollActive?.id, 'scroll-close');
  assert.equal(typeof fireAsyncClose, 'function');
  fireAsyncClose();
  assert.equal(ss.isOpen(), true, 'delayed quest close event must not disturb open scroll studio');
  assert.equal(h.doc.activeElement, scrollActive, 'delayed quest close event must not steal focus back');

  questDialog.close = origClose;
  assert.equal(ss.close(), true);

  // Clean dispose removes all buttons from #hud-top-dock
  ss.dispose();
  guide.dispose();
  w.qs.dispose();
  assert.equal(h.doc.getElementById('scroll-open'), null);
  assert.equal(h.doc.getElementById('guide-open'), null);
  assert.equal(h.doc.getElementById('quest-open'), null);
  assert.equal(dock.children.length, 0);

  // Static HTML/CSS top dock & <=480px capsule layout contracts
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(indexHtml, /<nav[^>]*id="hud-top-dock"[\s\S]*?id="journal-open"[\s\S]*?<\/nav>/);
  assert.ok(styleCss.includes('.hud-top-dock'), 'style.css defines .hud-top-dock');
  assert.match(styleCss, /#hud-top-dock\s*>\s*#quest-open\s*\{\s*order:\s*4;\s*\}/);
  assert.match(styleCss, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.sky\s*\{[^}]*\+\s*42px/s);
}

// 6. Proximity Prompt Hint + Quest Dialogue Tag + Pentatonic Plucks + Map Markers + Portrait Tracker Clearance
{
  const h = createHarness();
  const w = makeMockWorld(h);

  const greeterTarget = { kind: 'community', key: 'c_greeter', name: '村口施茶老丈', ref: { role: 'outskirt_greeter' } };
  const teaHostTarget = { kind: 'community', key: 'c_teahost', name: '松风茶翁', ref: { role: 'mountain_tea_host' } };

  // Prompt hint before accepting
  assert.deepEqual(w.villagerDialogue.getPromptHint(greeterTarget), {
    kind: 'offer',
    tag: '似有托付',
    questId: 'side-tea-message',
    title: '施茶传信'
  });

  // Accept triggers noteIdx 0 & reply carries questKind='offer'
  const turn0 = w.villagerDialogue.beginOrAdvance(greeterTarget);
  const qReply = turn0.replies.find(r => r.topic === '__quest__');
  assert.equal(qReply?.questKind, 'offer');
  w.villagerDialogue.chooseReply(qReply.index);
  assert.equal(w.plucks.at(-1), 0, 'accepting side quest triggers noteIdx 0 pluck');
  w.villagerDialogue.chooseReply(0);

  // Target villager hint -> intermediate step noteIdx 1 -> turn-in hint
  assert.equal(w.villagerDialogue.getPromptHint(teaHostTarget)?.tag, '简册所访');
  w.villagerDialogue.beginOrAdvance(teaHostTarget);
  w.villagerDialogue.chooseReply(0);
  w.villagerDialogue.chooseReply(0);
  assert.equal(w.plucks.at(-1), 1, 'intermediate step triggers noteIdx 1 pluck');
  assert.equal(w.villagerDialogue.getPromptHint(greeterTarget)?.tag, '待捎回音');

  // Map markers before return include main + active side + available rumors
  const markersMid = w.qs.getMapMarkers();
  assert.ok(markersMid.some(m => m.kind === 'main' && m.glyph === '传'), 'main marker exported');
  assert.ok(markersMid.some(m => m.questId === 'side-tea-message' && m.kind === 'active' && m.glyph === '笺'), 'active side marker exported');
  assert.ok(markersMid.some(m => m.kind === 'available' && m.glyph === '访'), 'available rumor marker exported');

  // Completing via return triggers noteIdx 2 & leaves turnIn prompt + 信 marker until dialogue turn-in
  const retTurn = w.villagerDialogue.beginOrAdvance(greeterTarget);
  assert.equal(w.plucks.at(-1), 2, 'side completion triggers noteIdx 2 pluck');
  assert.equal(w.villagerDialogue.getPromptHint(greeterTarget)?.tag, '待捎回音');
  assert.ok(w.qs.getMapMarkers().some(m => m.questId === 'side-tea-message' && m.kind === 'turnIn' && m.glyph === '信'));

  const turnInReply = retTurn.replies.find(r => r.topic === '__quest__');
  assert.equal(turnInReply?.questKind, 'turnIn');
  w.villagerDialogue.chooseReply(turnInReply.index);
  assert.equal(w.villagerDialogue.getPromptHint(greeterTarget), null, 'prompt hint clears once turned in');
  assert.ok(!w.qs.getMapMarkers().some(m => m.questId === 'side-tea-message'), 'finished & turned-in side quest clears map marker');

  w.qs.dispose();

  // Static CSS / wiring contracts across map.js, main.js, interaction.js, style.css, quest-system.js
  const mapSrc = readFileSync(new URL('../src/systems/map.js', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const interSrc = readFileSync(new URL('../src/systems/interaction.js', import.meta.url), 'utf8');
  const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(questSrc, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?#quest-tracker\s*\{[^}]*\+\s*98px[\s\S]*?#quest-tracker\.is-collapsed\s*\{[^}]*\+\s*42px/s);
  assert.ok(mapSrc.includes('drawQuestMarks') && mapSrc.includes('hitQuestMarkAt') && mapSrc.includes('refs.questSystem'));
  assert.ok(mainSrc.includes('map.setRuntimeSources?.({ questSystem })'));
  assert.ok(interSrc.includes('getPromptHint') && interSrc.includes('talk-reply--quest'));
  assert.ok(styleCss.includes('.talk-reply--quest') && styleCss.includes('.talk-reply__quest-tag'));
}

console.log('PASS quest-system: main story sync, 9 side quests across 3 categories, dialogue bridge, wayfinder, seal linkage, top dock, prompt hint, map markers, audio plucks, KeyQ guard and dispose');
