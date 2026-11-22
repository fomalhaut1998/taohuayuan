import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createRiverCurve } from '../src/world/stream.js';
import { createRiverSkiff } from '../src/systems/river-skiff.js';
import { createGodFlight } from '../src/systems/god-flight.js';

const text = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const [html, css, main, worldRaw, ...inkSources] = await Promise.all([
  'index.html',
  'src/style.css',
  'src/main.js',
  'src/data/world.json',
  'src/world/ink-landscape.js',
  'src/systems/contact-shadows.js',
  'src/systems/rain-water.js',
  'src/systems/twilight-water.js',
  'src/systems/god-flight.js',
  'src/systems/river-skiff.js'
].map(text));
const world = JSON.parse(worldRaw);

for (const src of inkSources) {
  assert(!/\bconsole\.log\s*\(/.test(src), 'no debug console.log in runtime ink/HUD modules');
}

const dock = html.match(/<div id="hud-footer"[^>]*>([\s\S]*?)<!-- hud-footer end -->/);
assert(dock, 'bottom controls share one layout container instead of independent overlapping fixed offsets');
for (const id of ['view', 'fps', 'hint', 'stats']) {
  assert(dock[1].includes('id="' + id + '"'), 'footer owns ' + id);
  assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'one accessible ID: ' + id);
}
assert(/#hud-footer\s*\{[^}]*display:\s*grid/s.test(css), 'normal-flow grid allocates control and wrapping hint lanes');
assert(/#hint\s*\{[^}]*white-space:\s*normal/s.test(css), 'hint can wrap on narrow displays');
assert(css.includes('env(safe-area-inset-bottom, 0px)'), 'safe area reserved');
assert(/bottom:\s*max[(]64px,\s*5[.]2vh,\s*env[(]safe-area-inset-bottom, 0px[)][)]/.test(css), 'minimap clears the 18px + 32px UI toggle even at 720px height');
assert(/\.hint__group\s*\{[^}]*white-space:\s*nowrap/s.test(css), 'individual shortcut stays together');
assert(/@media[^}]*max-width: 600px/s.test(css), 'narrow viewport has explicit compact footer layout');
assert(css.includes('.fps[hidden]') && /[.]fps\[hidden\]\s*\{[^}]*display:\s*none/s.test(css), 'F all-hidden cannot be overridden by the flex layout');
assert(/body\.ui-hidden #hud-footer,\s*body\.ui-hidden #hud-footer \*[\s\S]*?visibility:\s*hidden\s*!important;\s*pointer-events:\s*none\s*!important/s.test(css), 'ui-hidden isolates hud-footer and interactive children');
assert(/body\.map-open #hud-footer,\s*body\.map-open #hud-footer \*[\s\S]*?visibility:\s*hidden\s*!important;\s*pointer-events:\s*none\s*!important/s.test(css), 'map-open isolates hud-footer and interactive children');
assert(/#view \.view__alt,\s*#view \.view__fly\s*\{/s.test(css) && /body\.is-night #view \.view__alt,\s*body\.is-night #view \.view__fly/s.test(css), 'paper-ink day/night styling for view__fly and view__alt');
assert(!/sGraph[.]style[.]width\s*=/.test(main), 'inline fixed graph width cannot override compact card sizing');
assert(!/shadowMap[.]enabled\s*=\s*true|EffectComposer|SSAOPass|SSRPass/.test(main), 'no heavyweight renderer pipeline');

const at = token => { const n = main.indexOf(token); assert(n >= 0, 'missing ink wiring: ' + token); return n; };
for (const token of ['const contactShadows = createContactShadows(', 'const rainWater = createRainWater(', 'const twilightWater = createWaterSurface(']) at(token);
assert.equal((main.match(/contactShadows[.]update[(]/g) || []).length, 1, 'contact shadows have one normal-clock update');
assert.equal((main.match(/rainWater[.]update[(]/g) || []).length, 1, 'rain water has one normal-clock update');
assert.equal((main.match(/mountains[.]update[(]/g) || []).length, 1, 'mountain haze has one normal-clock update');
assert(at('mountains.update(dt, sky, camera)') > at('sky.update(dt, camera)'), 'haze follows sky');
const idxQhComp = main.search(/qinHanCompletion\.update\((?:dt|r6Dt),\s*elapsed,\s*sky,\s*player\.state\)/);
const idxRainW = main.search(/rainWater\.update\((?:dt|r6Dt),\s*elapsed,\s*sky,\s*camera\)/);
assert(idxQhComp >= 0 && idxRainW > idxQhComp, 'reuse existing eaves before rain-water update');
assert(at('contactShadows.update(dt, elapsed, camera, sky)') > at('portalVisibility?.update('), 'contact shadows follow owner/portal visibility');
assert(at('contactShadows.update(dt, elapsed, camera, sky)') < main.lastIndexOf('staticVisibility.render(renderer, camera)'), 'contacts update before real draw');
assert(main.includes('legacyEaves: qinHanCompletion.group'), 'do not duplicate existing roof curtains');
assert(main.includes('homestead: qinHanHomestead'), 'real buffalo metadata is connected');
assert(main.includes('staticTargets: contactStaticTargets'), 'village/hinterland/grove/homestead static targets connected');
assert(main.includes('!player.state.aboardSkiff'), 'traveler ground shadow suppressed while aboard skiff');
assert(main.includes('shelters: qinHanCompletion.shelters'), 'keep spatial rain sound integration');
assert(main.includes('document.hidden || !document.hasFocus()'), 'background pause rule retained');

// Behavioral test: river-skiff + god-flight preserve <span class="hint__group"> markup across transitions
{
  const hintMatch = html.match(/<div id="hint"[^>]*>([\s\S]*?)<\/div>/);
  assert(hintMatch, 'index.html defines #hint');
  const initialWalkHtml = hintMatch[1].trim();
  assert(initialWalkHtml.includes('hint__group'), 'initial walk hint uses .hint__group spans');

  let rawHtml = initialWalkHtml;
  const hintEl = {
    dataset: {},
    get innerHTML() { return rawHtml; },
    set innerHTML(v) { rawHtml = String(v); },
    get textContent() { return rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); },
    set textContent(v) { rawHtml = String(v); },
    querySelectorAll(sel) {
      if (sel === '.hint__group') return rawHtml.match(/class="[^"]*\bhint__group\b[^"]*"/g) || [];
      return [];
    }
  };
  const viewEl = { style: {}, children: [], appendChild(c) { this.children.push(c); } };
  const viewNameEl = { textContent: '第三人称' };
  const bodyClasses = new Set(['curtain-open']);
  const doc = {
    body: { classList: { contains: c => bodyClasses.has(c), add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c) } },
    getElementById(id) {
      if (id === 'hint') return hintEl;
      if (id === 'view') return viewEl;
      if (id === 'view-name') return viewNameEl;
      return null;
    },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), style: { cssText: '' }, textContent: '', setAttribute() {}, addEventListener() {}, blur() {}, classList: { toggle() {} } };
    }
  };
  const win = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
  const curve = createRiverCurve(world.stream.points);
  const fakeStream = { surfaceY: () => -1.0 };
  const fakeField = { sample: (x) => (Math.abs(x) < 6 ? -2.2 : 1.5), slope: () => 0.05 };
  const player = { state: { x: 24, y: 0.5, z: 180, yaw: 0, pitch: 0, view: 'third', still: false, speed: 0 }, syncCamera() {} };
  const avatar = { group: new THREE.Group(), update() {} };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

  const skiff = createRiverSkiff({ world, riverCurve: curve, stream: fakeStream, field: fakeField });
  skiff.bind({ player, avatar, camera, hintEl, doc, win, autoBoard: true });
  assert.equal(player.state.aboardSkiff, true, 'starts aboard skiff by default');
  assert.equal(hintEl.querySelectorAll('.hint__group').length, 4, 'skiff hint uses 4 .hint__group spans (WASD / X / E / V)');
  assert(hintEl.dataset.walkHintHtml?.includes('hint__group'), 'canonical walkHintHtml saved before skiff overwrite');

  const gf = createGodFlight({ scene: new THREE.Scene(), camera, player, avatar, canvas: { addEventListener() {}, removeEventListener() {} }, world, field: fakeField, doc, win });
  gf.toggle(true);
  assert(hintEl.querySelectorAll('.hint__group').length >= 7, 'god-flight hint uses .hint__group spans');
  gf.toggle();
  assert.equal(hintEl.querySelectorAll('.hint__group').length, 4, 'exiting god-flight while aboard restores skiff .hint__group spans');

  skiff.disembark();
  assert.equal(player.state.aboardSkiff, false, 'disembarked onto shore');
  assert.equal(hintEl.innerHTML, initialWalkHtml, 'disembarking restores exact index.html .hint__group walk markup');

  gf.toggle(true);
  gf.toggle();
  assert.equal(hintEl.innerHTML, initialWalkHtml, 'exiting god-flight on foot restores exact index.html .hint__group walk markup');

  gf.dispose();
  skiff.dispose();
}

console.log(JSON.stringify({inkIntegration: true, footerFlow: true, wrappingShortcuts: true, hintGroupsPreserved: true, normalClockOnly: true, reuseEavesAndAudio: true}));
