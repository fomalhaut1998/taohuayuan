import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { createPlayer } from '../src/player/controller.js';
import { createTouchControls } from '../src/player/touch-controls.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createGodFlight } from '../src/systems/god-flight.js';
import { createSituationalRest } from '../src/systems/situational-rest.js';
import { createQuiet } from '../src/systems/quiet.js';
import { createPoeticInteractions } from '../src/systems/poetic-interactions.js';
import { createInteraction } from '../src/systems/interaction.js';
import { createDiscovery } from '../src/systems/discovery.js';
import { createMap } from '../src/systems/map.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';
import { createScrollStudio } from '../src/systems/scroll-studio.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const mapExpansion = JSON.parse(readFileSync(new URL('../src/data/map-expansion.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

const prevDoc = globalThis.document;
const prevWin = globalThis.window;
const prevStorage = globalThis.localStorage;
const prevRaf = globalThis.requestAnimationFrame;
const prevCancelRaf = globalThis.cancelAnimationFrame;
const prevPath2D = globalThis.Path2D;

function makeMockCtx2d(cv) {
  cv._texts = cv._texts || [];
  const base = {
    canvas: cv,
    fillStyle: '#f2ead9',
    strokeStyle: '#262626',
    lineWidth: 1,
    globalAlpha: 1,
    font: '12px serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    clearRect() { cv._texts = []; },
    fillText(value, x, y) {
      cv._texts.push({
        value: String(value || ''),
        x,
        y,
        w: String(value || '').length * 10.5,
        textAlign: base.textAlign
      });
    },
    measureText: s => ({ width: String(s || '').length * 10.5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
}

function makeMockEnv({ coarse = true, width = 390, height = 844 } = {}) {
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

  function findById(root, id) {
    if (!root) return null;
    if (root.id === id) return root;
    for (const c of root.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  }

  const makeNode = (tag, id = '') => {
    const node = {
      tagName: tag.toUpperCase(),
      id,
      className: '',
      classList: makeClassList(),
      style: { cssText: '', setProperty() {} },
      textContent: '',
      _html: '',
      value: '',
      title: '',
      hidden: false,
      disabled: false,
      open: false,
      isConnected: true,
      clientWidth: id === 'map-sheet' ? 360 : 120,
      clientHeight: id === 'map-sheet' ? 210 : 120,
      width: 360,
      height: 210,
      dataset: {},
      children: [],
      attributes: new Map(),
      listeners: new Map(),
      parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      insertBefore(c, ref) {
        const idx = this.children.indexOf(ref);
        c.parentNode = this;
        if (idx >= 0) this.children.splice(idx, 0, c);
        else this.children.push(c);
        return c;
      },
      replaceChildren(...cs) { this.children = cs; cs.forEach(c => { c.parentNode = this; }); },
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(c => c !== this);
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
        const event = { target: this, currentTarget: this, preventDefault() { event.defaultPrevented = true; }, stopPropagation() {}, defaultPrevented: false, ...ev };
        for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
        return event;
      },
      focus() {},
      blur() {},
      closest() { return null; },
      getBoundingClientRect() {
        if (this.id === 'touch-stick') return { left: 14, top: height - 124, width: 108, height: 108 };
        if (this.id === 'map-canvas' || this.id === 'map-sheet') return { left: 0, top: 0, width: 360, height: 210 };
        if (this.id === 'minimap') return { left: width - 92, top: 112, width: 82, height: 82 };
        return { left: 0, top: 0, width, height };
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return findById(this, sel.slice(1));
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          const walk = n => {
            if (!n) return null;
            if (n.classList?.contains(cls) || String(n.className || '').split(/\s+/).includes(cls)) return n;
            for (const c of n.children || []) {
              const hit = walk(c);
              if (hit) return hit;
            }
            return null;
          };
          return walk(this);
        }
        return null;
      },
      querySelectorAll() { return []; },
      getContext() {
        if (!this._ctx2d) this._ctx2d = makeMockCtx2d(this);
        return this._ctx2d;
      },
      toDataURL() { return 'data:image/png;base64,iVBORw0KGgo='; }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return node._html; },
      set(val) {
        node._html = String(val || '');
        node.children.length = 0;
        const idMatches = node._html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g);
        for (const m of idMatches) {
          const child = makeNode(m[1], m[2]);
          node.appendChild(child);
        }
      }
    });
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

  const head = makeNode('head');
  const body = makeNode('body');
  body.classList.add('curtain-open');
  const docListeners = new Map();
  const winListeners = new Map();
  const storageMap = new Map();

  const fixedIds = [
    ['canvas', 'scene'], ['div', 'hint'], ['div', 'view'], ['span', 'view-name'],
    ['div', 'prompt'], ['span', 'prompt-text'], ['div', 'reticle'],
    ['div', 'talk'], ['div', 'talk-who'], ['div', 'talk-line'],
    ['div', 'quiet-notice'], ['button', 'quiet-exit'], ['div', 'mystery-note'],
    ['div', 'map'], ['div', 'map-sheet'], ['canvas', 'map-canvas'], ['button', 'map-close'],
    ['ol', 'map-list'], ['span', 'map-region'], ['span', 'map-dest'], ['span', 'map-time'],
    ['p', 'map-count'], ['p', 'map-note-name'], ['p', 'map-note-poem'], ['p', 'map-dist'],
    ['div', 'minimap'], ['canvas', 'minimap-canvas'], ['span', 'minimap-region'],
    ['div', 'toast'], ['span', 'toast-k'], ['span', 'toast-name'],
    ['dialog', 'journal']
  ];
  for (const [tag, id] of fixedIds) body.appendChild(makeNode(tag, id));
  const mapHintEl = makeNode('p');
  mapHintEl.className = 'map__hint';
  findById(body, 'map').appendChild(mapHintEl);

  const doc = {
    head,
    body,
    hidden: false,
    hasFocus: () => true,
    pointerLockElement: null,
    activeElement: body,
    exitPointerLock() { doc.pointerLockElement = null; },
    createElement(tag) { return makeNode(tag); },
    getElementById(id) { return findById(head, id) || findById(body, id); },
    querySelector: () => null,
    addEventListener(k, fn) {
      if (!docListeners.has(k)) docListeners.set(k, new Set());
      docListeners.get(k).add(fn);
    },
    removeEventListener(k, fn) { docListeners.get(k)?.delete(fn); },
    dispatch(k, ev = {}) {
      for (const fn of [...(docListeners.get(k) || [])]) fn(ev);
    }
  };

  const win = {
    location: { search: '' },
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 2,
    navigator: { maxTouchPoints: coarse ? 5 : 0 },
    matchMedia: q => ({ matches: coarse && q === '(pointer: coarse)' }),
    localStorage: {
      getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => { storageMap.set(k, String(v)); },
      removeItem: k => { storageMap.delete(k); }
    },
    addEventListener(k, fn) {
      if (!winListeners.has(k)) winListeners.set(k, new Set());
      winListeners.get(k).add(fn);
    },
    removeEventListener(k, fn) { winListeners.get(k)?.delete(fn); },
    dispatchEvent(ev) {
      const t = ev?.type || 'keydown';
      for (const fn of [...(winListeners.get(t) || [])]) fn(ev);
      return true;
    },
    fireKey(code, extra = {}) {
      const ev = {
        type: 'keydown',
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: body,
        defaultPrevented: false,
        preventDefault() { ev.defaultPrevented = true; },
        stopImmediatePropagation() {},
        ...extra
      };
      for (const fn of [...(winListeners.get('keydown') || [])]) fn(ev);
      return ev;
    }
  };

  return { doc, win, body, makeNode };
}

try {
  // 1. Source hygiene & mobile adaptation static contracts
  const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const scrollSrc = readFileSync(new URL('../src/systems/scroll-studio.js', import.meta.url), 'utf8');
  const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
  const sampleAudioSrc = readFileSync(new URL('../src/systems/sample-audio.js', import.meta.url), 'utf8');
  const touchSrc = readFileSync(new URL('../src/player/touch-controls.js', import.meta.url), 'utf8');

  assert.ok(htmlSrc.includes('apple-mobile-web-app-capable'), 'index.html adds mobile web-app meta tags');
  assert.ok(styleCss.includes('height: 100dvh;') && styleCss.includes('overscroll-behavior: none;'), 'style.css locks 100dvh and disables pull-to-refresh overscroll');
  assert.ok(styleCss.includes('touch-action: none;'), 'style.css sets touch-action: none on #scene and #map-canvas');
  assert.ok(scrollSrc.includes('font-size: 16px;'), 'scroll-studio.js prevents iOS Safari auto-zoom on input focus');
  assert.ok(soundSrc.includes("ctx.state === 'interrupted'") && sampleAudioSrc.includes("ctx.state === 'interrupted'"), 'sound & sample-audio recover iOS interrupted AudioContext');
  assert.ok(mainSrc.includes('baseCameraFov') && mainSrc.includes('orientationchange') && mainSrc.includes('visualViewport'), 'main.js adapts portrait FOV and orientation/visualViewport resize');
  assert.equal(/\bconsole\.log\s*\(/.test(touchSrc), false, 'touch-controls.js contains zero console.log');
  assert.ok(/\.touch-pill\s*\{(?:(?!\n\}).)*touch-action:\s*none;/s.test(touchSrc), 'touch-controls.js sets touch-action: none on .touch-pill');
  assert.ok(/#touch-actions,\s*#touch-flight-pad\s*\{[^}]*pointer-events:\s*none;/s.test(touchSrc), 'touch-controls.js sets pointer-events: none on #touch-actions and #touch-flight-pad');
  assert.ok(touchSrc.includes('#hud-top-dock > button span'), 'touch-controls.js hides keycap hints on all #hud-top-dock buttons');
  for (const cssVar of ['--hud-dock-bottom', '--hud-sky-bottom', '--hud-after-footer', '--hud-after-toggle', '--hud-controls-top']) {
    assert.ok(touchSrc.includes(cssVar), `touch-controls.js defines dynamic layout variable ${cssVar}`);
  }
  assert.equal(/body\.touch-active\s+#journal-open\s*\{/.test(touchSrc), false, 'touch-controls.js removes legacy hardcoded #journal-open left offset');
  assert.equal(/body\.ui-hidden\s+#touch-controls\b/.test(touchSrc), false, 'ui-hidden does not hide the entire #touch-controls container');
  for (const hiddenSel of [
    'body.ui-hidden #touch-pentatonic',
    'body.ui-hidden #touch-act-o',
    'body.ui-hidden #touch-act-c',
    'body.ui-hidden #touch-act-g',
    'body.ui-hidden #touch-act-m',
    'body.ui-hidden #touch-actions:not(.is-aboard) #touch-act-e',
    'body.ui-hidden #touch-actions.is-aboard #touch-act-jump'
  ]) {
    assert.ok(touchSrc.includes(hiddenSel), `touch-controls.js hides ${hiddenSel} under ui-hidden`);
  }
  assert.ok(/body\.touch-active\.ui-hidden\s+#touch-stick\s*\{[^}]*opacity:\s*0\.[45]/s.test(touchSrc), 'touch-controls.js dims #touch-stick slightly when resting under ui-hidden');

  // 2. Player analog touch speed, touch sprint, clickable #view, pointer-lock bypass on coarse
  const env = makeMockEnv({ coarse: true, width: 390, height: 844 });
  globalThis.document = env.doc;
  globalThis.window = env.win;
  globalThis.localStorage = env.win.localStorage;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.Path2D = class { moveTo() {} lineTo() {} };

  const field = { sample: () => 0, slope: () => 0.05 };
  const canvas = env.doc.getElementById('scene');
  let pointerLockRequested = 0;
  canvas.requestPointerLock = () => { pointerLockRequested++; };
  const viewEl = env.doc.getElementById('view');
  const viewNameEl = env.doc.getElementById('view-name');
  const cam = new THREE.PerspectiveCamera(62, 390 / 844, 0.1, 400);

  const player = createPlayer(canvas, world.player, field, world.terrain, env.doc.getElementById('hint'), {
    viewEl,
    viewNameEl,
    blockers: []
  });

  // Pointer lock is NOT triggered on touch/coarse environment
  env.body.classList.add('touch-active');
  canvas.dispatch('click');
  assert.equal(pointerLockRequested, 0, 'touch-active skips canvas.requestPointerLock');

  // Tapping #view toggles third/first person, but ignores #view-fly child
  assert.equal(player.state.view, 'third', 'defaults to third-person view');
  assert.equal(viewNameEl.textContent, '第三人称', 'view label defaults to 第三人称');
  assert.equal(viewEl.classList.contains('view--third'), true, '#view carries view--third class by default');
  viewEl.dispatch('click');
  assert.equal(player.state.view, 'first', 'clicking #view toggles to first person');
  viewEl.dispatch('click', { target: { closest: sel => (sel === '#view-fly' ? {} : null) } });
  assert.equal(player.state.view, 'first', 'clicking #view-fly inside #view does not toggle view');
  viewEl.dispatch('click');
  assert.equal(player.state.view, 'third', 'clicking #view toggles back to third person');

  // Analog speed vs sprint
  player.setTouchMove(0, 0.4);
  for (let i = 0; i < 20; i++) player.update(0.05, cam);
  const gentleSpeed = player.state.speed;
  assert.ok(gentleSpeed > 1.2 && gentleSpeed < 2.2, `gentle touch deflection yields gentle speed (${gentleSpeed.toFixed(2)})`);

  player.setTouchMove(0, 1);
  player.setTouchSprint(true);
  for (let i = 0; i < 30; i++) player.update(0.05, cam);
  const sprintSpeed = player.state.speed;
  assert.ok(sprintSpeed > 6.4, `touch sprint reaches runSpeed (${sprintSpeed.toFixed(2)})`);
  player.clearInput();

  // 3. River skiff touch rowing & drift toggle
  const curve = createRiverCurve(world.stream.points);
  const skiffField = { sample: () => -2.2, slope: () => 0.05 };
  const skiff = createRiverSkiff({ world, riverCurve: curve, stream: { surfaceY: () => world.terrain.waterLevel }, field: skiffField });
  skiff.bind({
    player,
    avatar: { group: new THREE.Group(), update() {} },
    camera: cam,
    doc: env.doc,
    win: env.win,
    autoBoard: true
  });
  const t0 = skiff.getStats().t;
  player.setTouchMove(0, 1);
  for (let i = 0; i < 20; i++) skiff.update(0.05, i * 0.05, null, player.state, cam, false);
  assert.equal(skiff.getStats().punting, true, 'skiff rows when touchMoveZ > 0');
  assert.ok(skiff.getStats().t > t0 + 0.002, `skiff advances upstream via touch joystick (${t0} -> ${skiff.getStats().t})`);
  player.setTouchMove(0, 0);
  assert.equal(skiff.toggleDrift(), true, 'skiff toggleDrift enables drifting');
  assert.equal(skiff.isDrifting(), true);
  assert.equal(skiff.toggleDrift(), false, 'skiff toggleDrift resumes punting');
  skiff.disembark();

  // 4. God flight touch controls & TouchControls routing
  const godFlight = createGodFlight({
    scene: new THREE.Scene(),
    camera: cam,
    player,
    avatar: { group: new THREE.Group(), update() {} },
    canvas,
    world,
    field,
    doc: env.doc,
    win: env.win
  });
  const startX = player.state.x;
  const startZ = player.state.z;
  const quiet = createQuiet(player, canvas, [{ x: startX, z: startZ, radius: 10, name: '溪声' }], {
    doc: env.doc,
    win: env.win
  });
  const poetic = createPoeticInteractions({
    world,
    field,
    player,
    camera: cam,
    situationalRest: { active: true, currentSeat: { id: 'pond-stool' } },
    doc: env.doc,
    win: env.win
  });

  const tc = createTouchControls({
    canvas,
    player,
    sound: { unlock() {} },
    getGodFlight: () => godFlight,
    getPoeticInteractions: () => poetic,
    getRiverSkiff: () => skiff,
    getQuiet: () => quiet,
    doc: env.doc,
    win: env.win,
    forceEnable: true
  });

  // Floating stick zone moves stick center & activates sprint on outer push
  const stickZone = env.doc.getElementById('touch-stick-zone');
  const stickEl = env.doc.getElementById('touch-stick');
  assert.ok(stickZone && stickEl, 'mounts floating stick zone and stick');
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 616 }] });
  assert.equal(tc.getStats().sprinting, true, 'pushing stick to outer ring activates sprint');
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 616 }] });
  assert.equal(tc.getStats().sprinting, false, 'releasing stick clears sprint');

  // 4B. Multi-touch: hold joystick forward + jump button + camera look + repeated jump after clearInput + ghost-click suppression
  const jumpBtn = env.doc.getElementById('touch-act-jump');
  assert.ok(jumpBtn, 'mounts #touch-act-jump');
  player.state.y = 0;
  player.state.grounded = true;
  player.state.airborne = false;
  player.state.vy = 0;
  const pressesBeforeMulti = tc.getStats().actionPresses;

  // Finger 1 (id 10): push stick forward
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 618 }] });
  assert.ok(tc.getStats().stick.z > 0.7, 'finger 10 holds stick forward');

  // Finger 2 (id 11): drag canvas simultaneously to rotate camera
  const yawBeforeMulti = player.state.targetYaw;
  canvas.dispatch('touchstart', {
    changedTouches: [{ identifier: 11, clientX: 240, clientY: 420 }],
    touches: [{ identifier: 10, clientX: 60, clientY: 618 }, { identifier: 11, clientX: 240, clientY: 420 }]
  });
  canvas.dispatch('touchmove', {
    changedTouches: [{ identifier: 11, clientX: 270, clientY: 410 }],
    touches: [{ identifier: 10, clientX: 60, clientY: 618 }, { identifier: 11, clientX: 270, clientY: 410 }]
  });
  assert.ok(player.state.targetYaw < yawBeforeMulti, '3-finger look drag rotates camera while stick is held');

  // Finger 3 (id 12): tap jump button via touchstart while stick & look remain active
  jumpBtn.dispatch('touchstart', {
    changedTouches: [{ identifier: 12, clientX: 310, clientY: 790 }],
    touches: [
      { identifier: 10, clientX: 60, clientY: 618 },
      { identifier: 11, clientX: 270, clientY: 410 },
      { identifier: 12, clientX: 310, clientY: 790 }
    ]
  });
  // Synthetic ghost click shortly after touchstart must be suppressed
  jumpBtn.dispatch('click');
  assert.equal(tc.getStats().actionPresses, pressesBeforeMulti + 1, 'touchstart jump triggers once & suppresses ghost click');

  player.update(0.05, cam);
  assert.equal(player.state.airborne, true, 'simultaneous touch jump enters airborne state while joystick held forward');
  assert.ok(player.state.speed > 0.5, 'joystick forward speed remains active during jump');

  // Releasing jump (id 12) and look (id 11) leaves joystick (id 10) intact
  jumpBtn.dispatch('touchend', {
    changedTouches: [{ identifier: 12, clientX: 310, clientY: 790 }],
    touches: [{ identifier: 10, clientX: 60, clientY: 618 }, { identifier: 11, clientX: 270, clientY: 410 }]
  });
  canvas.dispatch('touchend', {
    changedTouches: [{ identifier: 11, clientX: 270, clientY: 410 }],
    touches: [{ identifier: 10, clientX: 60, clientY: 618 }]
  });
  assert.ok(tc.getStats().stick.z > 0.7, 'stick remains active after releasing jump & look fingers');

  // Land, clearInput(), then jump again to ensure Space never locks in suspendedKeys
  for (let i = 0; i < 30; i++) player.update(0.05, cam);
  assert.equal(player.state.grounded, true, 'player lands back cleanly');
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 10, clientX: 60, clientY: 618 }], touches: [] });
  assert.equal(tc.getStats().stick.z, 0, 'releasing stick finger zeroes stick');
  player.clearInput();

  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 15, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 15, clientX: 60, clientY: 620 }] });
  jumpBtn.dispatch('touchstart', { changedTouches: [{ identifier: 16, clientX: 310, clientY: 790 }] });
  jumpBtn.dispatch('touchend', { changedTouches: [{ identifier: 16, clientX: 310, clientY: 790 }] });
  player.update(0.05, cam);
  assert.equal(player.state.airborne, true, 'touch jump still works after player.clearInput()');
  for (let i = 0; i < 30; i++) player.update(0.05, cam);
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 15, clientX: 60, clientY: 620 }] });
  player.clearInput();
  player.state.x = startX;
  player.state.z = startZ;
  player.state.y = 0;
  player.state.yaw = world.player.spawn.yaw;
  player.state.targetYaw = world.player.spawn.yaw;
  player.state.pitch = world.player.spawn.pitch ?? 0;
  player.state.targetPitch = world.player.spawn.pitch ?? 0;

  // God flight routing & multi-touch through touch controls
  godFlight.enter();
  tc.update(0.2);
  const flyPad = env.doc.getElementById('touch-flight-pad');
  assert.equal(flyPad.hidden, false, 'flight pad appears in god-flight mode');
  const flyBeforeY = godFlight.getState().y;
  const flyYawBefore = godFlight.getState().yaw;
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 30, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 30, clientX: 60, clientY: 620 }] });
  env.doc.getElementById('touch-fly-up').dispatch('touchstart', { changedTouches: [{ identifier: 31, clientX: 300, clientY: 720 }] });
  canvas.dispatch('touchstart', { changedTouches: [{ identifier: 32, clientX: 280, clientY: 400 }] });
  canvas.dispatch('touchmove', { changedTouches: [{ identifier: 32, clientX: 320, clientY: 380 }] });
  for (let i = 0; i < 6; i++) godFlight.update(0.05);
  const yStartDelta = godFlight.getState().y;
  for (let i = 0; i < 4; i++) godFlight.update(0.05);
  const yDeltaWhileUp = godFlight.getState().y - yStartDelta;
  assert.ok(godFlight.getState().y > flyBeforeY + 3 && yDeltaWhileUp > 2, 'holding touch-fly-up ascends camera while stick & look are active');
  assert.ok(godFlight.getState().yaw < flyYawBefore, 'canvas touch drag rotates god-flight camera during multi-touch');
  env.doc.getElementById('touch-fly-up').dispatch('touchend', { changedTouches: [{ identifier: 31, clientX: 300, clientY: 720 }] });
  assert.ok(tc.getStats().stick.z > 0.7, 'god-flight stick remains held after releasing touch-fly-up');
  const flyAfterReleaseY = godFlight.getState().y;
  for (let i = 0; i < 4; i++) godFlight.update(0.05);
  const yDeltaAfterRelease = godFlight.getState().y - flyAfterReleaseY;
  assert.ok(yDeltaAfterRelease < yDeltaWhileUp * 0.4, `releasing touch-fly-up stops vertical climb (${yDeltaWhileUp.toFixed(2)} -> ${yDeltaAfterRelease.toFixed(2)})`);
  canvas.dispatch('touchend', { changedTouches: [{ identifier: 32, clientX: 320, clientY: 380 }] });
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 30, clientX: 60, clientY: 620 }] });
  const yAfterStickRelease = godFlight.getState().y;
  for (let i = 0; i < 4; i++) godFlight.update(0.05);
  assert.ok(Math.abs(godFlight.getState().y - yAfterStickRelease) < 1e-6, 'god-flight stops cleanly once stick & vertical are released');
  // Also preserve backward compatibility when synthetic touchstart/touchend omits changedTouches
  const ySynthBefore = godFlight.getState().y;
  env.doc.getElementById('touch-fly-up').dispatch('touchstart');
  for (let i = 0; i < 4; i++) godFlight.update(0.05);
  env.doc.getElementById('touch-fly-up').dispatch('touchend');
  assert.ok(godFlight.getState().y > ySynthBefore + 1.5, 'touch-fly-up handles synthetic events without changedTouches');
  env.doc.getElementById('touch-fly-exit').dispatch('click');
  assert.equal(godFlight.active, false, 'touch-fly-exit exits god flight');
  tc.update(0.2);
  assert.equal(flyPad.hidden, true, 'flight pad hides after exiting god flight');

  // 5. Situational rest & quiet mode exit smoothly on joystick push; quiet notice tap toggles quiet
  const seatField = { sample: () => 0, walkSurface: () => 0, slope: () => 0.05 };
  const rest = createSituationalRest({
    world,
    field: seatField,
    player,
    avatar: { state: {}, group: new THREE.Group(), update() {} },
    camera: cam,
    leisureGrove: { layout: { regions: [{ kind: 'pavilion', x: player.state.x, z: player.state.z - 1, y: 0 }] } },
    doc: env.doc,
    win: env.win
  });
  const sitRes = rest.sitAt('pavilion-seat');
  assert.ok(sitRes && rest.active, 'sitAt enters seated state');
  for (let i = 0; i < 10; i++) rest.update(0.05, i * 0.05, null, player.state, cam);
  player.setTouchMove(0, 0.6);
  rest.update(0.05, 0.6, null, player.state, cam);
  assert.equal(rest.active, false, 'pushing touch stick exits seated state');
  player.setTouchMove(0, 0);

  const quietNotice = env.doc.getElementById('quiet-notice');
  quiet.update();
  assert.ok(quietNotice.textContent.includes('轻点驻足'), 'touch quiet prompt shows tap hint');
  quietNotice.dispatch('click');
  assert.equal(quiet.active, true, 'tapping #quiet-notice enters quiet mode');
  assert.ok(quietNotice.textContent.includes('轻推摇杆离开'), 'active touch quiet notice shows stick-exit hint');
  player.setTouchMove(0, 0.5);
  quiet.update();
  assert.equal(quiet.active, false, 'pushing touch stick exits quiet mode');
  player.setTouchMove(0, 0);

  // 6. Pentatonic touch strip plays notes & updates via tc.update
  tc.update(0.2);
  const pentEl = env.doc.getElementById('touch-pentatonic');
  assert.equal(pentEl.hidden, false, 'pentatonic strip shows when poetic spot is playable');
  env.doc.getElementById('touch-note-3').dispatch('click');
  assert.equal(poetic.getStats().lastPentatonicNote, 2, 'tapping touch-note-3 plays pentatonic 角 note');

  // 7. Direct click on #prompt & #discovery-label triggers interaction and discovery
  let greeted = 0;
  const interaction = createInteraction(
    world.interaction,
    scriptData,
    { list: [{ x: player.state.x, z: player.state.z - 2.0, s: 1, role: 'elder' }], greet() { greeted++; } },
    { animals: [] },
    field,
    player,
    { unlock() {}, voice() {} },
    null,
    [],
    null,
    null
  );
  player.state.y = 0;
  player.state.yaw = 0;
  player.state.targetYaw = 0;
  player.state.camYaw = 0;
  player.state.pitch = 0;
  player.state.targetPitch = 0;
  player.state.camPitch = 0;
  cam.position.set(player.state.x, 1.68, player.state.z);
  cam.rotation.set(0, 0, 0, 'YXZ');
  cam.updateMatrixWorld();
  interaction.update(0.05, 0.05, cam);
  const promptEl = env.doc.getElementById('prompt');
  assert.equal(promptEl.classList.contains('show'), true, 'prompt shows when facing NPC');
  promptEl.dispatch('click');
  assert.equal(greeted, 1, 'tapping #prompt triggers NPC interaction');
  // Also verify multi-touch tap on #prompt while stick is held dispatches KeyE without dropping stick
  interaction.update(5, 5, cam);
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 40, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 40, clientX: 60, clientY: 625 }] });
  promptEl.dispatch('touchstart', { changedTouches: [{ identifier: 41, clientX: 195, clientY: 450 }] });
  assert.equal(greeted, 2, 'multi-touch touchstart on #prompt triggers NPC interaction while stick held');
  assert.ok(tc.getStats().stick.z > 0.5, 'stick stays active after multi-touch #prompt tap');
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 40, clientX: 60, clientY: 625 }] });
  player.clearInput();

  const discovery = createDiscovery({
    world,
    field: { sample: () => world.terrain.waterLevel - 0.5, slope: () => 0.05 },
    camera: cam,
    player,
    canvas,
    journal: { isOpen: () => false, observe: () => true },
    riverSpine: [[player.state.x, player.state.z - 3]]
  });
  player.state.pitch = -0.5;
  player.state.targetPitch = -0.5;
  player.state.camPitch = -0.5;
  player.syncCamera(cam);
  cam.updateMatrixWorld();
  discovery.update(0.25, true);
  const discLabel = env.doc.getElementById('discovery-label');
  assert.equal(discLabel.hidden, false, 'discovery label shows near target');
  discLabel.dispatch('click');
  assert.equal(discovery.isOpen, true, 'tapping #discovery-label opens field guide');
  discovery.close();

  // 8. Compact mobile map collision-free labels (all 24 POIs unlocked), locate button, pinch-zoom, 1-finger pan & double-tap
  const allPoisMerged = world.map.pois.concat(mapExpansion.pois || []);
  const allPoiIds = allPoisMerged.map(p => p.id);
  const poiNameSet = new Set(allPoisMerged.map(p => p.name));
  const map = createMap(world.map, world, {
    field: { sample: () => 0 },
    spots: [],
    houseInfo: [],
    marks: [],
    chimneys: [],
    spine: sampleRiverSpine(curve, 120),
    canvas,
    player,
    visited: allPoiIds
  });
  map.open();
  const mapCanvas = env.doc.getElementById('map-canvas');
  const drawnPoiLabels = (mapCanvas._texts || []).filter(t => poiNameSet.has(t.value));
  assert.ok(drawnPoiLabels.length >= 6, `compact mobile map renders legible core POI labels (${drawnPoiLabels.length})`);
  const labelRects = drawnPoiLabels.map(t => {
    const x0 = t.textAlign === 'right' ? t.x - t.w : t.textAlign === 'center' ? t.x - t.w * 0.5 : t.x;
    return [x0, t.y - 6.5, x0 + t.w, t.y + 6.5, t.value];
  });
  for (const r of labelRects) {
    assert.ok(r[0] >= 6 && r[2] <= 354 && r[1] >= 4 && r[3] <= 206, `label "${r[4]}" clamped inside 360x210 canvas`);
  }
  for (let i = 0; i < labelRects.length; i++) {
    for (let j = i + 1; j < labelRects.length; j++) {
      const a = labelRects[i];
      const b = labelRects[j];
      const ov = a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      assert.equal(ov, false, `compact map labels "${a[4]}" and "${b[4]}" must not overlap`);
    }
  }

  const locateBtn = env.doc.getElementById('map-sheet').querySelector('.map__tool-locate');
  assert.ok(locateBtn, 'map mounts .map__tool-locate button');
  locateBtn.dispatch('click');
  assert.ok(map.getStats().zoom >= 2.0, `tapping locate zooms in cleanly (${map.getStats().zoom})`);
  // Reset via double-tap before pinch test
  mapCanvas.dispatch('touchstart', { touches: [{ identifier: 10, clientX: 160, clientY: 95 }] });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 10, clientX: 160, clientY: 95 }] });
  mapCanvas.dispatch('touchstart', { touches: [{ identifier: 11, clientX: 160, clientY: 95 }] });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 11, clientX: 160, clientY: 95 }] });
  assert.equal(map.getStats().zoom, 1, 'double-tap resets locate zoom back to 1x');

  const zoom0 = map.getStats().zoom;
  mapCanvas.dispatch('touchstart', {
    touches: [{ identifier: 1, clientX: 120, clientY: 100 }, { identifier: 2, clientX: 200, clientY: 100 }]
  });
  mapCanvas.dispatch('touchmove', {
    touches: [{ identifier: 1, clientX: 80, clientY: 100 }, { identifier: 2, clientX: 240, clientY: 100 }]
  });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 80, clientY: 100 }] });
  const zoomPinch = map.getStats().zoom;
  assert.ok(zoomPinch > zoom0 + 0.5, `2-finger pinch zooms map (${zoom0} -> ${zoomPinch})`);
  assert.equal(map.getDestination(), null, 'pinch gesture does not drop an accidental pin');

  // 1-finger pan while zoomed in
  mapCanvas.dispatch('touchstart', { touches: [{ identifier: 2, clientX: 180, clientY: 120 }] });
  mapCanvas.dispatch('touchmove', { touches: [{ identifier: 2, clientX: 130, clientY: 90 }] });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 2, clientX: 130, clientY: 90 }] });
  assert.equal(map.getDestination(), null, '1-finger pan does not drop a pin');
  assert.equal(map.getStats().zoom, zoomPinch, '1-finger pan preserves zoom');

  // Double-tap resets zoom cleanly when zoomed in
  mapCanvas.dispatch('touchstart', { touches: [{ identifier: 3, clientX: 180, clientY: 105 }] });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 3, clientX: 180, clientY: 105 }] });
  mapCanvas.dispatch('touchstart', { touches: [{ identifier: 4, clientX: 180, clientY: 105 }] });
  mapCanvas.dispatch('touchend', { touches: [], changedTouches: [{ identifier: 4, clientX: 180, clientY: 105 }] });
  assert.equal(map.getStats().zoom, 1, 'double-tap resets zoomed map back to 1x');
  map.close();

  // Cruise capture button appears during cruise and calls openCapture()
  let captureOpened = 0;
  const guide = createTravelerGuideAndCruise({
    camera: cam,
    player,
    canvas,
    field,
    map,
    journal: { isOpen: () => false },
    getScrollStudio: () => ({ isOpen: () => false, openCapture() { captureOpened++; } }),
    getGodFlight: () => godFlight,
    doc: env.doc,
    win: env.win
  });
  const captureBtn = env.doc.getElementById('cruise-capture');
  assert.ok(captureBtn && captureBtn.hidden === true, 'cruise-capture mounts hidden before cruise');
  guide.startCruise();
  assert.equal(captureBtn.hidden, false, 'cruise-capture shows during cruise');
  captureBtn.dispatch('click');
  assert.equal(captureOpened, 1, 'tapping #cruise-capture opens scroll studio capture');
  guide.stopCruise();
  assert.equal(captureBtn.hidden, true, 'cruise-capture hides when cruise stops');

  // 8B. ui-hidden retains essential mobile locomotion & unstuck controls while hiding non-essential buttons
  env.body.classList.add('ui-hidden');
  tc.update(0.2);
  assert.equal(pentEl.hidden, true, 'pentatonic strip stays hidden during ui-hidden even at poetic spot');

  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 50, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 50, clientX: 60, clientY: 618 }] });
  assert.ok(tc.getStats().stick.z > 0.7, 'joystick moves character forward during ui-hidden');
  assert.equal(stickEl.classList.contains('is-active'), true, 'joystick gets is-active while touched under ui-hidden');
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 50, clientX: 60, clientY: 618 }], touches: [] });
  assert.equal(stickEl.classList.contains('is-active'), false, 'joystick clears is-active when released');

  const yawBeforeUiHidden = player.state.targetYaw;
  canvas.dispatch('touchstart', { changedTouches: [{ identifier: 51, clientX: 240, clientY: 420 }], touches: [{ identifier: 51, clientX: 240, clientY: 420 }] });
  canvas.dispatch('touchmove', { changedTouches: [{ identifier: 51, clientX: 276, clientY: 410 }], touches: [{ identifier: 51, clientX: 276, clientY: 410 }] });
  canvas.dispatch('touchend', { changedTouches: [{ identifier: 51, clientX: 276, clientY: 410 }], touches: [] });
  assert.ok(player.state.targetYaw < yawBeforeUiHidden, 'canvas touch drag rotates camera during ui-hidden');

  player.state.y = 0;
  player.state.grounded = true;
  player.state.airborne = false;
  player.state.vy = 0;
  jumpBtn.dispatch('touchstart', { changedTouches: [{ identifier: 52, clientX: 310, clientY: 790 }] });
  jumpBtn.dispatch('touchend', { changedTouches: [{ identifier: 52, clientX: 310, clientY: 790 }] });
  player.update(0.05, cam);
  assert.equal(player.state.airborne, true, 'jump button remains functional during ui-hidden');
  for (let i = 0; i < 30; i++) player.update(0.05, cam);
  player.clearInput();

  const pressesBeforeIgnored = tc.getStats().actionPresses;
  for (const ignoredId of ['touch-act-m', 'touch-act-g', 'touch-act-o', 'touch-act-c', 'touch-act-e']) {
    env.doc.getElementById(ignoredId).dispatch('click');
  }
  assert.equal(tc.getStats().actionPresses, pressesBeforeIgnored, 'non-essential action buttons do not trigger during ui-hidden on foot');
  assert.equal(map.isOpen(), false, 'map button stays ignored during ui-hidden');

  // Aboard skiff in ui-hidden: drift (X) & disembark (E) remain usable
  assert.equal(skiff.board(true), true, 'boards skiff for ui-hidden skiff control check');
  tc.update(0.2);
  const actionsEl = env.doc.getElementById('touch-actions');
  const driftBtn = env.doc.getElementById('touch-act-drift');
  assert.equal(actionsEl.classList.contains('is-aboard'), true, '#touch-actions reflects is-aboard');
  assert.equal(driftBtn.hidden, false, 'drift button shows when aboard during ui-hidden');
  for (let i = 0; i < 6; i++) skiff.update(0.05, i * 0.05, null, player.state, cam, false);
  driftBtn.dispatch('click');
  assert.equal(skiff.isDrifting(), true, 'drift button toggles skiff drift during ui-hidden');
  env.doc.getElementById('touch-act-e').dispatch('click');
  assert.equal(skiff.isAboard(), false, 'disembark button still exits skiff during ui-hidden');
  assert.equal(player.state.aboardSkiff, false, 'player aboardSkiff clears after disembark in ui-hidden');
  tc.update(0.2);
  assert.equal(actionsEl.classList.contains('is-aboard'), false, '#touch-actions clears is-aboard after disembark');
  assert.equal(driftBtn.hidden, true, 'drift button hides after disembark');

  // God-flight in ui-hidden: flight pad & joystick/look remain active
  godFlight.enter();
  tc.update(0.2);
  assert.equal(flyPad.hidden, false, 'flight pad remains visible during ui-hidden');
  const flyHiddenBeforeY = godFlight.getState().y;
  const flyHiddenYawBefore = godFlight.getState().yaw;
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 53, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 53, clientX: 60, clientY: 620 }] });
  env.doc.getElementById('touch-fly-up').dispatch('touchstart', { changedTouches: [{ identifier: 54, clientX: 300, clientY: 720 }] });
  canvas.dispatch('touchstart', { changedTouches: [{ identifier: 55, clientX: 280, clientY: 400 }] });
  canvas.dispatch('touchmove', { changedTouches: [{ identifier: 55, clientX: 318, clientY: 382 }] });
  for (let i = 0; i < 6; i++) godFlight.update(0.05);
  assert.ok(godFlight.getState().y > flyHiddenBeforeY + 2, 'god-flight ascend works during ui-hidden');
  assert.ok(godFlight.getState().yaw < flyHiddenYawBefore, 'god-flight look drag works during ui-hidden');
  env.doc.getElementById('touch-fly-up').dispatch('touchend', { changedTouches: [{ identifier: 54, clientX: 300, clientY: 720 }] });
  canvas.dispatch('touchend', { changedTouches: [{ identifier: 55, clientX: 318, clientY: 382 }] });
  stickZone.dispatch('touchend', { changedTouches: [{ identifier: 53, clientX: 60, clientY: 620 }] });
  env.doc.getElementById('touch-fly-exit').dispatch('click');
  assert.equal(godFlight.active, false, 'touch-fly-exit exits god-flight during ui-hidden');
  tc.update(0.2);
  assert.equal(flyPad.hidden, true, 'flight pad hides after exiting god-flight');

  // Real modal still blocks touch controls even when ui-hidden is set
  env.body.classList.add('map-open');
  stickZone.dispatch('touchstart', { changedTouches: [{ identifier: 56, clientX: 60, clientY: 660 }] });
  stickZone.dispatch('touchmove', { changedTouches: [{ identifier: 56, clientX: 60, clientY: 618 }] });
  assert.equal(tc.getStats().stick.z, 0, 'real modal still blocks touch joystick while ui-hidden is active');
  env.body.classList.remove('map-open');

  env.body.classList.remove('ui-hidden');
  tc.update(0.2);
  assert.equal(pentEl.hidden, false, 'pentatonic strip restores cleanly when exiting ui-hidden');

  // 9. Scroll Studio dynamic dialog title ('宣纸横卷题跋' <-> '宣纸立轴题跋')
  const studio = createScrollStudio({
    canvas,
    player,
    field,
    map,
    sky: { timeId: 'day', weatherId: 'clear' },
    renderSceneNow() {},
    world,
    doc: env.doc,
    win: env.win,
    storage: env.win.localStorage
  });
  studio.openCapture();
  const studioTitle = env.doc.getElementById('scroll-dialog-title');
  assert.equal(studioTitle?.textContent, '宣纸横卷题跋', 'handscroll mode shows 宣纸横卷题跋 title');
  env.doc.getElementById('scroll-mount-toggle')?.dispatch('click');
  assert.equal(studioTitle?.textContent, '宣纸立轴题跋', 'hanging mode toggles title to 宣纸立轴题跋');
  studio.closeDialog?.();
  studio.dispose();

  // Clean dispose verification
  guide.dispose();
  assert.equal(env.doc.getElementById('cruise-capture'), null, 'guide dispose removes #cruise-capture');
  map.dispose();
  discovery.dispose();
  interaction.dispose();
  tc.dispose();
  assert.equal(env.doc.getElementById('touch-controls'), null, 'touchControls dispose removes DOM');
  assert.equal(env.body.classList.contains('touch-active'), false, 'touchControls dispose removes body.touch-active');
  poetic.dispose();
  rest.dispose();
  godFlight.dispose();
  skiff.dispose();
  player.dispose();

  console.log('PASS check-mobile-adaptation: floating joystick/sprint, skiff rowing, god-flight touch, rest/quiet exit, pentatonic strip, prompt/discovery tap, map pinch/double-tap, cruise capture & mobile CSS/Audio/FOV contracts all verified');
} finally {
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
  globalThis.localStorage = prevStorage;
  globalThis.requestAnimationFrame = prevRaf;
  globalThis.cancelAnimationFrame = prevCancelRaf;
  globalThis.Path2D = prevPath2D;
}
