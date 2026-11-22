import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOpeningCurtain } from '../src/systems/opening-curtain.js';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// 1. HTML & CSS contracts for four-season illustration cover, loading progress bar & post-entry guide
assert.ok(indexHtml.includes('class="cover-backdrop"'), 'index.html includes panoramic illustration backdrop');
assert.ok(indexHtml.includes('class="cover-scene-svg"'), 'index.html includes scenic SVG illustration');
assert.ok(indexHtml.includes('id="cover-petals-canvas"'), 'index.html includes ambient seasonal particles canvas');
assert.ok(indexHtml.includes('id="cover-enter-btn"'), 'index.html includes explicit click-to-enter button');
assert.ok(indexHtml.includes('class="cover-loader"'), 'index.html includes loading progress container');
assert.ok(indexHtml.includes('id="cover-progress-track"') && indexHtml.includes('role="progressbar"'), 'index.html exposes accessible progressbar');
assert.ok(indexHtml.includes('id="cover-load-stage"') && indexHtml.includes('id="cover-load-percent"'), 'index.html includes stage text and percent readout');
assert.ok(indexHtml.includes('class="cover-season-bar"'), 'index.html includes four-season cover switcher');
for (const s of ['spring', 'summer', 'autumn', 'winter']) {
  assert.ok(indexHtml.includes(`data-season="${s}"`), `index.html includes season button: ${s}`);
}
assert.ok(indexHtml.includes('id="entry-welcome-guide"'), 'index.html includes gentle post-entry welcome guide');
assert.ok(styleCss.includes('.cover-enter-btn') && styleCss.includes('.cover-progress-fill'), 'style.css styles enter CTA and progress fill');
assert.ok(
  styleCss.includes('#veil[data-cover-season="summer"]') &&
  styleCss.includes('#veil[data-cover-season="autumn"]') &&
  styleCss.includes('#veil[data-cover-season="winter"]'),
  'style.css defines all four seasonal illustration palettes'
);
assert.ok(styleCss.includes('.entry-welcome-guide') && styleCss.includes('body.is-night .entry-welcome-guide'), 'style.css styles day/night post-entry welcome guide');
assert.ok(styleCss.includes('@media (prefers-reduced-motion: reduce)'), 'style.css honors prefers-reduced-motion on cover animations');

const veilStart = indexHtml.indexOf('id="veil"');
const veilEnd = indexHtml.indexOf('<div id="gloom">', veilStart + 20);
const veilHtml = indexHtml.slice(veilStart, veilEnd);
const gradIds = [...veilHtml.matchAll(/<(?:linear|radial)Gradient[^>]*id="([^"]+)"/g)].map((m) => m[1]);
assert.ok(gradIds.length >= 20, `fresh illustration uses rich multi-layer gradients (got ${gradIds.length})`);
assert.equal(new Set(gradIds).size, gradIds.length, 'all SVG gradient IDs inside #veil are strictly unique');

// 2. Deterministic mock-DOM test of season switching + click-to-enter loading + post-entry guide
function makeMockEl(id = '', dataset = {}) {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  return {
    id,
    dataset,
    hidden: false,
    disabled: false,
    textContent: '',
    lastChild: { nodeType: 3, textContent: '' },
    style: { setProperty() {} },
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const next = force !== undefined ? Boolean(force) : !classes.has(c);
        if (next) classes.add(c); else classes.delete(c);
        return next;
      }
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t).add(fn);
    },
    removeEventListener: (t, fn) => listeners.get(t)?.delete(fn),
    dispatch(t, ev = {}) {
      for (const fn of [...(listeners.get(t) || [])]) fn({ currentTarget: this, ...ev });
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

const bodyClasses = new Set();
const enterBtn = makeMockEl('cover-enter-btn');
const seasonLabelEl = makeMockEl('cover-season-label');
const epigraphEl = makeMockEl('cover-epigraph');
const seasonBtns = ['spring', 'summer', 'autumn', 'winter'].map((s) => makeMockEl(`btn-${s}`, { season: s }));
const loaderEl = makeMockEl('cover-loader');
loaderEl.hidden = true;
const stageEl = makeMockEl('cover-load-stage');
const percentEl = makeMockEl('cover-load-percent');
const trackEl = makeMockEl('cover-progress-track');
const fillEl = makeMockEl('cover-progress-fill');
const sparkEl = makeMockEl('cover-progress-spark');
const stepEls = [0, 1, 2, 3].map((i) => makeMockEl(`step-${i}`));
const innerNodes = [makeMockEl('cover-backdrop'), makeMockEl('ink-left'), makeMockEl('ink-right')];
const guideEl = makeMockEl('entry-welcome-guide');
guideEl.hidden = true;
const guideTextEl = makeMockEl('entry-welcome-text');
const sceneCanvas = makeMockEl('scene');

const veilEl = makeMockEl('veil');
veilEl.querySelector = (sel) => ({
  '#cover-enter-btn': enterBtn,
  '#cover-season-label': seasonLabelEl,
  '#cover-epigraph': epigraphEl,
  '.cover-loader': loaderEl,
  '#cover-load-stage': stageEl,
  '#cover-load-percent': percentEl,
  '#cover-progress-track': trackEl,
  '#cover-progress-fill': fillEl,
  '#cover-progress-spark': sparkEl
})[sel] || null;
veilEl.querySelectorAll = (sel) => {
  if (sel === '.cover-step') return stepEls;
  if (sel === '.cover-season-btn') return seasonBtns;
  if (sel.includes('cover-backdrop')) return innerNodes;
  return [];
};

const timerQueue = [];
let nextTimerId = 1;
const winListeners = new Map();

globalThis.document = {
  getElementById: (id) => ({
    veil: veilEl,
    'cover-enter-btn': enterBtn,
    'cover-season-label': seasonLabelEl,
    'cover-epigraph': epigraphEl,
    'cover-load-stage': stageEl,
    'cover-load-percent': percentEl,
    'cover-progress-track': trackEl,
    'cover-progress-fill': fillEl,
    'cover-progress-spark': sparkEl,
    'entry-welcome-guide': guideEl,
    'entry-welcome-text': guideTextEl,
    scene: sceneCanvas
  })[id] || null,
  body: {
    classList: {
      add: (...cs) => cs.forEach((c) => bodyClasses.add(c)),
      remove: (...cs) => cs.forEach((c) => bodyClasses.delete(c)),
      contains: (c) => bodyClasses.has(c)
    }
  }
};
globalThis.window = {
  location: { search: '' },
  addEventListener: (t, fn) => {
    if (!winListeners.has(t)) winListeners.set(t, new Set());
    winListeners.get(t).add(fn);
  },
  removeEventListener: (t, fn) => winListeners.get(t)?.delete(fn),
  setTimeout: (fn, ms = 0) => {
    const id = nextTimerId++;
    timerQueue.push({ id, fn, ms, canceled: false });
    return id;
  },
  clearTimeout: (id) => {
    const item = timerQueue.find((t) => t.id === id);
    if (item) item.canceled = true;
  }
};

function flushTimers(limit = 50) {
  let n = 0;
  while (timerQueue.length && n++ < limit) {
    const item = timerQueue.shift();
    if (!item.canceled) item.fn();
  }
}

let unlocked = 0;
let plucked = 0;
let warmedSeason = null;
const curtain = createOpeningCurtain({
  sound: {
    muted: false,
    unlock() { unlocked++; },
    guqinPluck() { plucked++; }
  },
  veilEl,
  prepareEntry: {
    triggerWarmup(season) { warmedSeason = season; },
    getProgress() {
      return { runtimeReady: true, shadersReady: true, audioRatio: 1, framesReady: true };
    },
    getWelcomeText() {
      return '轻点画面环顾溪山 · W/S 撑篙泛舟 · E 舍船登岸 · K 换四时';
    }
  }
});

assert.equal(curtain.isOpen(), false, 'cover starts closed');
assert.equal(curtain.getSeason(), 'spring', 'cover defaults to spring');
assert.equal(veilEl.getAttribute('data-cover-season'), 'spring', 'initial data-cover-season is spring');

// Switch season to autumn before entering
seasonBtns[2].dispatch('click', { stopPropagation() {} });
assert.equal(curtain.getSeason(), 'autumn', 'clicking autumn pill switches cover season');
assert.equal(veilEl.getAttribute('data-cover-season'), 'autumn', 'veil updates data-cover-season attribute');
assert.ok(epigraphEl.textContent.includes('丹枫'), 'epigraph updates to autumn verse');
assert.equal(seasonBtns[2].getAttribute('aria-checked'), 'true', 'autumn radio button checked');
assert.equal(seasonBtns[0].getAttribute('aria-checked'), 'false', 'spring radio button unchecked');

// Clicking enter triggers loading progress sequence & passes chosen season into warmup
enterBtn.dispatch('click', { stopPropagation() {} });
assert.equal(curtain.isEntering(), true, 'clicking enter starts loading state');
assert.equal(curtain.isOpen(), false, 'cover waits for loading bar before parting');
assert.equal(unlocked, 1, 'audio unlocks synchronously on user click');
assert.equal(plucked, 1, 'gentle guqin welcome note triggers on click');
assert.equal(enterBtn.disabled, true, 'enter button disables during loading');
assert.equal(loaderEl.hidden, false, 'loading progress console becomes visible');
assert.equal(veilEl.classList.contains('cover-loading'), true, 'veil enters cover-loading state');
assert.equal(curtain.setSeason('winter'), false, 'season switching locks while loading');
assert.equal(curtain.startEntry(), false, 'duplicate entry click is ignored while loading');

// Flush timers to finish loading, open curtain, and show/dismiss post-entry guide
let guideSeenVisible = false;
let stepGuard = 0;
while (timerQueue.length && stepGuard++ < 40) {
  const item = timerQueue.shift();
  if (!item.canceled) item.fn();
  if (!guideEl.hidden && guideEl.classList.contains('show')) {
    guideSeenVisible = true;
    assert.ok(guideTextEl.textContent.includes('撑篙泛舟'), 'post-entry welcome guide shows tailored copy');
  }
}

assert.equal(warmedSeason, 'autumn', 'prepareEntry.triggerWarmup receives chosen cover season');
assert.equal(curtain.getLoadProgress(), 1, 'progress reaches 100%');
assert.equal(percentEl.textContent, '100%', 'percent label finishes at 100%');
assert.equal(trackEl.getAttribute('aria-valuenow'), '100', 'ARIA progressbar reaches 100');
assert.equal(stageEl.textContent, '画卷已展 · 豁然开朗', 'final poetic stage text rendered');
assert.ok(stepEls.every((s) => s.classList.contains('is-done')), 'all 4 milestone chips finish as done');
assert.equal(curtain.isOpen(), true, 'curtain opens after loading finishes');
assert.equal(bodyClasses.has('curtain-open'), true, 'body receives curtain-open');
assert.equal(guideSeenVisible, true, 'post-entry welcome guide appears smoothly after curtain opens');
assert.equal(guideEl.hidden, true, 'post-entry welcome guide auto-dismisses cleanly');
assert.ok(innerNodes.every((n) => n.style.display === 'none'), 'cover layers hide cleanly after parting');

curtain.dispose();
console.log('PASS check-opening-cover:', JSON.stringify({
  gradients: gradIds.length,
  warmedSeason,
  finalPercent: percentEl.textContent,
  finalStage: stageEl.textContent,
  guideSeenVisible
}));
