import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PROJECT_META } from '../src/systems/project-meta.js';
import { createOpeningCurtain } from '../src/systems/opening-curtain.js';
import { createTravelerGuideAndCruise } from '../src/systems/traveler-guide-cruise.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// 1. PROJECT_META derives faithfully from package.json
const expectedRepo = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '')
  .replace(/^git\+/, '')
  .replace(/\.git$/i, '')
  .replace(/\/+$/, '');
assert.equal(PROJECT_META.version, pkg.version, 'PROJECT_META.version matches package.json');
assert.equal(PROJECT_META.versionLabel, `v${pkg.version}`, 'PROJECT_META.versionLabel uses v-prefix');
assert.equal(PROJECT_META.repoUrl, expectedRepo, 'PROJECT_META.repoUrl matches package.json repository');
assert.equal(PROJECT_META.repoSlug, 'fomalhaut1998/taohuayuan', 'PROJECT_META.repoSlug extracts owner/repo');
assert.equal(PROJECT_META.releasesUrl, `${expectedRepo}/releases`, 'PROJECT_META.releasesUrl builds releases link');
assert.equal(PROJECT_META.license, pkg.license, 'PROJECT_META.license matches package.json');
assert.equal(PROJECT_META.licenseUrl, `${expectedRepo}/blob/main/LICENSE`, 'PROJECT_META.licenseUrl points to LICENSE');

// 2. index.html contracts for cover footer & epilogue colophon (and unique SVG gradient IDs inside #veil)
for (const marker of [
  'class="cover-footer"',
  'class="cover-open-source"',
  'id="cover-repo-link"',
  'id="cover-version-link"',
  'class="ink-epilogue-colophon"',
  'id="epilogue-repo-link"',
  'data-app-version',
  'rel="noopener noreferrer"',
  'https://github.com/fomalhaut1998/taohuayuan'
]) {
  assert.ok(indexHtml.includes(marker), `index.html includes ${marker}`);
}
const veilStart = indexHtml.indexOf('id="veil"');
const veilEnd = indexHtml.indexOf('<div id="gloom">', veilStart + 20);
const veilHtml = indexHtml.slice(veilStart, veilEnd);
const gradIds = [...veilHtml.matchAll(/<(?:linear|radial)Gradient[^>]*id="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(gradIds).size, gradIds.length, 'SVG gradient IDs inside #veil remain strictly unique');

// 3. style.css contracts
for (const selector of [
  '.cover-footer',
  '.cover-open-source',
  '#veil.cover-loading .cover-footer',
  '.ink-epilogue-colophon'
]) {
  assert.ok(styleCss.includes(selector), `src/style.css defines ${selector}`);
}

const prevDoc = globalThis.document;
const prevWin = globalThis.window;

try {
  // 4. createOpeningCurtain hydrates [data-app-version] and ignores Enter when focus is inside .cover-open-source
  const timerQueue = [];
  let nextTimerId = 1;
  const winListeners = new Map();
  let startTriggerCount = 0;

  function makeCoverNode(id = '', tagName = 'DIV') {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    return {
      id,
      tagName,
      hidden: false,
      disabled: false,
      textContent: '',
      lastChild: { nodeType: 3, textContent: '' },
      style: { setProperty() {} },
      dataset: {},
      classList: {
        add: (...cs) => cs.forEach(c => classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        contains: c => classes.has(c),
        toggle: (c, f) => {
          const next = f === undefined ? !classes.has(c) : Boolean(f);
          if (next) classes.add(c); else classes.delete(c);
          return next;
        }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      addEventListener: (t, fn) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t).add(fn);
      },
      removeEventListener: (t, fn) => listeners.get(t)?.delete(fn),
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    };
  }

  const coverVerEl = makeCoverNode('cover-ver', 'SPAN');
  coverVerEl.textContent = 'stale';
  const epilogueVerEl = makeCoverNode('epilogue-ver', 'SPAN');
  epilogueVerEl.textContent = 'stale';
  const coverRepoLink = makeCoverNode('cover-repo-link', 'A');
  coverRepoLink.closest = sel => (sel === '.cover-open-source' ? makeCoverNode('oss', 'DIV') : null);
  const enterBtn = makeCoverNode('cover-enter-btn', 'BUTTON');
  const veilEl = makeCoverNode('veil', 'DIV');
  veilEl.querySelector = sel => ({ '#cover-enter-btn': enterBtn }[sel] || null);
  veilEl.querySelectorAll = sel => (sel === '[data-app-version]' ? [coverVerEl, epilogueVerEl] : []);

  const mockDoc = {
    activeElement: null,
    body: makeCoverNode('body', 'BODY'),
    getElementById: id => ({ veil: veilEl, 'cover-enter-btn': enterBtn }[id] || null)
  };
  const mockWin = {
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
    clearTimeout: id => {
      const item = timerQueue.find(t => t.id === id);
      if (item) item.canceled = true;
    }
  };
  globalThis.document = mockDoc;
  globalThis.window = mockWin;

  const curtain = createOpeningCurtain({
    sound: { unlock() { startTriggerCount++; } },
    veilEl
  });
  assert.equal(coverVerEl.textContent, PROJECT_META.versionLabel, 'cover [data-app-version] hydrated from PROJECT_META');
  assert.equal(epilogueVerEl.textContent, PROJECT_META.versionLabel, 'epilogue [data-app-version] hydrated from PROJECT_META');

  // Focusing an open-source link and pressing Enter must not trigger startEntry()
  mockDoc.activeElement = coverRepoLink;
  let prevented = false;
  for (const fn of [...(winListeners.get('keydown') || [])]) {
    fn({ key: 'Enter', code: 'Enter', preventDefault() { prevented = true; } });
  }
  assert.equal(curtain.isEntering(), false, 'Enter on focused .cover-open-source link does not start entry');
  assert.equal(prevented, false, 'Enter on focused .cover-open-source link preserves native link activation');
  assert.equal(startTriggerCount, 0, 'sound unlock not fired when activating .cover-open-source link');
  curtain.dispose();

  // 5. createTravelerGuideAndCruise renders open-source colophon and cleans up on dispose()
  const byId = new Map();
  const guideWinListeners = new Map();
  function makeGuideEl(tag = 'DIV') {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    let idVal = '';
    const el = {
      tagName: tag.toUpperCase(),
      open: false,
      hidden: false,
      children: [],
      innerHTML: '',
      textContent: '',
      style: {},
      classList: {
        add: (...cs) => cs.forEach(c => classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        contains: c => classes.has(c)
      },
      get id() { return idVal; },
      set id(v) {
        if (idVal) byId.delete(idVal);
        idVal = String(v);
        if (idVal) byId.set(idVal, el);
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      addEventListener: (t, fn) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t).add(fn);
      },
      removeEventListener: (t, fn) => listeners.get(t)?.delete(fn),
      appendChild(child) {
        el.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      remove() {
        if (idVal) byId.delete(idVal);
      },
      querySelector: () => null,
      showModal() { el.open = true; },
      close() { el.open = false; }
    };
    return el;
  }
  const gDoc = {
    head: makeGuideEl('HEAD'),
    body: makeGuideEl('BODY'),
    createElement: tag => makeGuideEl(tag),
    getElementById: id => byId.get(id) || null
  };
  const gWin = {
    addEventListener: (t, fn) => {
      if (!guideWinListeners.has(t)) guideWinListeners.set(t, new Set());
      guideWinListeners.get(t).add(fn);
    },
    removeEventListener: (t, fn) => guideWinListeners.get(t)?.delete(fn)
  };
  const guide = createTravelerGuideAndCruise({
    camera: new THREE.PerspectiveCamera(),
    player: { state: { x: 0, y: 0, z: 0 }, clearInput() {} },
    canvas: makeGuideEl('CANVAS'),
    doc: gDoc,
    win: gWin
  });
  const dialog = byId.get('traveler-guide');
  assert.ok(dialog, '#traveler-guide dialog created');
  for (const snippet of [
    'class="tguide__about"',
    'id="tguide-repo-link"',
    'id="tguide-releases-link"',
    'id="tguide-license-link"',
    PROJECT_META.versionLabel,
    PROJECT_META.repoUrl,
    PROJECT_META.releasesUrl,
    PROJECT_META.licenseUrl,
    PROJECT_META.license
  ]) {
    assert.ok(dialog.innerHTML.includes(snippet), `#traveler-guide includes ${snippet}`);
  }
  guide.dispose();
  assert.equal(byId.get('traveler-guide') ?? null, null, '#traveler-guide removed cleanly on dispose()');

  // 6. Zero console.log in modified/new source files
  for (const rel of [
    'src/systems/project-meta.js',
    'src/systems/opening-curtain.js',
    'src/systems/traveler-guide-cruise.js'
  ]) {
    const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    assert.equal(/\bconsole\.log\s*\(/.test(src), false, `zero console.log in ${rel}`);
  }

  console.log('PASS check-project-meta:', JSON.stringify(PROJECT_META));
} finally {
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
}
