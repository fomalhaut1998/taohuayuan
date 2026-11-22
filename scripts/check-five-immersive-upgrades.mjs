import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHeightFunction, createRiverDistance, createMountains } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createCliff } from '../src/world/cliff.js';
import { createCavePassage } from '../src/world/cave-passage.js';
import { createCaveGleam } from '../src/world/cave-gleam.js';
import { createSky } from '../src/systems/sky.js';
import { createWorldClock } from '../src/systems/world-clock.js';
import { createGodFlight } from '../src/systems/god-flight.js';
import { createVillagerDialogue } from '../src/systems/villager-dialogue.js';
import { createInteraction } from '../src/systems/interaction.js';

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'));
const scriptData = JSON.parse(readFileSync(new URL('../src/data/script.json', import.meta.url), 'utf8'));

function makeMockEl(id, tagName = 'div') {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    id,
    tagName,
    children: [],
    style: {},
    dataset: {},
    hidden: false,
    _text: '',
    parentNode: null,
    className: '',
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v ?? '');
      if (this._text === '') this.children.length = 0;
    },
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, f) => (f === undefined ? (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)) : (f ? (classes.add(c), true) : (classes.delete(c), false))),
    },
    setAttribute(k, v) {
      this[k] = v;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      child.parentNode = this;
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
      return child;
    },
    remove() {
      if (this.parentNode?.children) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
      }
      this.parentNode = null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatch(type, evt = {}) {
      for (const fn of [...(listeners.get(type) || [])]) {
        fn({ target: this, preventDefault() {}, stopPropagation() {}, ...evt });
      }
    },
  };
  return el;
}

function createDomEnv() {
  const els = new Map();
  const body = makeMockEl('body', 'body');
  const winListeners = new Map();
  const docListeners = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const e = makeMockEl(id);
      if (id === 'talk') {
        const who = makeMockEl('talk-who');
        const line = makeMockEl('talk-line');
        els.set('talk-who', who);
        els.set('talk-line', line);
        e.appendChild(who);
        e.appendChild(line);
      }
      els.set(id, e);
    }
    return els.get(id);
  };
  const doc = {
    hidden: false,
    body,
    activeElement: null,
    hasFocus: () => true,
    getElementById: getEl,
    querySelector: () => null,
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          getContext: () => new Proxy({
            createRadialGradient: () => ({ addColorStop() {} }),
            createLinearGradient: () => ({ addColorStop() {} }),
          }, { get: (t, k) => t[k] ?? (() => {}) }),
        };
      }
      return makeMockEl('', tag);
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
  };
  const win = {
    location: { search: '' },
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchKey(code, extra = {}) {
      for (const fn of [...(winListeners.get('keydown') || [])]) {
        fn({ code, target: body, preventDefault() {}, stopPropagation() {}, ...extra });
      }
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  return { doc, win, getEl };
}

// =========================================================================
// 1. Layered Shan-Shui Mountains + Soft Dawn/Dusk + KeyT worldClock Sync
// =========================================================================
{
  const env = createDomEnv();
  env.doc.body.classList.add('curtain-open');
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const mountains = createMountains(world.mountains);
  assert.equal(mountains.isGroup, true);
  assert.ok(mountains.children.length >= 3, 'distant mountains composed of >= 3 layered ridges');
  const box = new THREE.Box3().setFromObject(mountains);
  assert.ok(box.max.y <= 65, `mountain silhouette crests stay under 65m (got ${box.max.y.toFixed(1)})`);
  for (const child of mountains.children) {
    assert.ok(child.geometry.getAttribute('color'), 'mountain ridge uses mist-to-crest vertex colors');
    assert.ok(child.geometry.getAttribute('position').count > 200, 'smooth continuous ridge (not 5-sided cone)');
  }

  // Verify dawn & dusk solar rays clear all ridge cols cleanly
  const ray = new THREE.Raycaster();
  const rayScene = new THREE.Scene();
  rayScene.add(mountains);
  rayScene.updateMatrixWorld(true);
  for (const timeKey of ['dawn', 'dusk']) {
    const dir = new THREE.Vector3(...world.sky.times[timeKey].sunDir).normalize();
    ray.set(new THREE.Vector3(0, 2, 0), dir);
    const hits = ray.intersectObjects(mountains.children, true);
    assert.equal(hits.length, 0, `${timeKey} sun azimuth clears mountain ridge cols`);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(world.render.background);
  scene.fog = new THREE.Fog(world.render.fogColor, world.render.fogNear, world.render.fogFar);
  const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400);
  const lights = {
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    fill: new THREE.DirectionalLight(),
  };
  const sky = createSky(world.sky, scene, { getPixelRatio: () => 1 }, cam, { lights });
  sky.setAuto(false);
  const smoke = { setWeather() {} };
  const clock = createWorldClock({ sky, smoke, doc: env.doc, win: env.win });
  assert.equal(sky.timeId, 'day');
  clock.update(0.016);
  assert.equal(env.getEl('sky-time').textContent, '昼·巳初');

  env.win.dispatchKey('KeyT');
  for (let i = 0; i < 60; i++) sky.update(0.05, cam);
  assert.equal(sky.timeId, 'dusk', 'KeyT calls cycleTime and enters dusk');
  assert.ok(sky.getTwilightState().amount > 0.5, 'dusk activates twilight shader appearance');
  clock.update(0.016);
  assert.equal(env.getEl('sky-time').textContent, '暮·酉初', 'worldClock syncs HUD shichen label after KeyT');

  env.win.dispatchKey('KeyT');
  clock.update(0.016);
  assert.equal(sky.timeId, 'night');
  assert.equal(env.getEl('sky-time').textContent, '夜·亥初');

  env.win.dispatchKey('KeyT');
  clock.update(0.016);
  assert.equal(sky.timeId, 'dawn');
  assert.equal(env.getEl('sky-time').textContent, '晨·卯初');

  clock.dispose?.();
  sky.dispose();
  mountains.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
}

// =========================================================================
// 2. God-Flight Live Altitude & Ground Clearance UI (#view-alt)
// =========================================================================
{
  const env = createDomEnv();
  env.doc.body.classList.add('curtain-open');
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const curve = createRiverCurve(world.stream.points);
  const river = createRiverDistance(sampleRiverSpine(curve, 120));
  const hFn = createHeightFunction(world.terrain, river);
  const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, 64, 64);
  grid.rotateX(-Math.PI / 2);
  const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => hFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
  const field = new Heightfield(world.terrain.size, 64, heights);

  const viewEl = env.getEl('view');
  viewEl.appendChild(env.getEl('view-name'));
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400);
  const player = { state: { x: 24, y: 2.0, z: -60, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.62 } };
  const avatar = { group: { visible: true } };
  const gf = createGodFlight({
    scene: new THREE.Scene(),
    camera,
    player,
    avatar,
    canvas: { addEventListener() {}, removeEventListener() {} },
    world,
    field,
    doc: env.doc,
    win: env.win,
  });

  const altEl = viewEl.children.find((c) => c.id === 'view-alt');
  assert.ok(altEl && altEl.style.cssText.includes('display:none'), 'altitude badge created and hidden initially');
  camera.position.set(24, 48.6, -60);
  assert.equal(gf.toggle(true), true);
  gf.update(0.016);
  assert.notEqual(altEl.style.display, 'none', 'altitude badge visible during god-flight');
  assert.ok(altEl.textContent.includes('海拔') && altEl.textContent.includes('离地'), `altitude readout formatted: ${altEl.textContent}`);
  const st0 = gf.getState();
  assert.ok(st0.altitude > 40 && st0.aboveGround > 40, 'altitude metrics numerically match flight height');
  env.win.dispatchKey('Space');
  gf.update(0.25);
  const st1 = gf.getState();
  assert.ok(st1.altitude > st0.altitude, 'climbing updates live altitude readout');
  assert.equal(gf.toggle(), true);
  assert.equal(gf.getState().active, false, 'toggle exits god-flight');
  assert.equal(altEl.style.display, 'none', 'altitude badge hides on exit');
  gf.dispose();
}

// =========================================================================
// 3. Lengthened Narrow Winding Cave + Scatter Clearance + Gleam + Act-3 Seal
// =========================================================================
{
  const env = createDomEnv();
  env.doc.body.classList.add('curtain-open');
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const curve = createRiverCurve(world.stream.points);
  const river = createRiverDistance(sampleRiverSpine(curve, 160));
  const hFn = createHeightFunction(world.terrain, river);
  const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
  grid.rotateX(-Math.PI / 2);
  const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => hFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
  const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
  const cliff = createCliff(world.cliff, field);

  const slit = cliff.slit;
  const ux = Math.cos(slit.angle), uz = Math.sin(slit.angle);
  const tx = -uz, tz = ux;

  // Dummy scatter instanced mesh placing one tuft right inside s=0
  const scatterGroup = new THREE.Group();
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), new THREE.MeshBasicMaterial(), 2);
  const m0 = new THREE.Matrix4().makeTranslation(slit.x, 2.0, slit.z);
  const m1 = new THREE.Matrix4().makeTranslation(slit.x + ux * 35, 2.0, slit.z + uz * 35);
  inst.setMatrixAt(0, m0);
  inst.setMatrixAt(1, m1);
  scatterGroup.add(inst);

  const cp = createCavePassage({ world, cliff, field, scatter: { group: scatterGroup } });
  const stats = cp.getStats();
  assert.equal(stats.built, true);
  assert.ok(stats.lengthMeters >= 40, `cave length >= 40m (got ${stats.lengthMeters})`);
  assert.ok(stats.minWidthMeters >= 1.6 && stats.minWidthMeters <= 2.2, `narrow throat 1.6-2.2m (got ${stats.minWidthMeters})`);
  assert.ok(stats.maxWidthMeters >= 4.5, `wide inner flare >= 4.5m (got ${stats.maxWidthMeters})`);
  assert.ok(cp.centerLat(15.5) < -0.25 && cp.centerLat(-15) > 0.45, 'S-curve deflects sightline');

  // Verify interior scatter tuft hidden below ground, exterior left untouched
  const outM0 = new THREE.Matrix4();
  const outM1 = new THREE.Matrix4();
  inst.getMatrixAt(0, outM0);
  inst.getMatrixAt(1, outM1);
  assert.ok(outM0.elements[13] < -1.0, 'interior scatter tuft pushed below ground');
  assert.equal(outM1.elements[13], 2.0, 'exterior scatter tuft untouched');

  // Walkability along full centerline with player collision pad 0.42
  function hitsBlocker(px, pz, pad = 0.42) {
    for (const b of cp.blockers) {
      if (b.maxY <= b.minY) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const dx = px - b.x, dz = pz - b.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true;
    }
    return false;
  }
  for (let s = -24.5; s <= 15.0; s += 0.5) {
    const lat = cp.centerLat(s);
    const wx = slit.x + ux * s + tx * lat;
    const wz = slit.z + uz * s + tz * lat;
    assert.equal(hitsBlocker(wx, wz, 0.42), false, `centerline passable at s=${s}`);
  }
  // Confirm lateral wall blocks player at s = 2
  const wallX = slit.x + ux * 2 + tx * (cp.centerLat(2) + 1.4);
  const wallZ = slit.z + uz * 2 + tz * (cp.centerLat(2) + 1.4);
  assert.equal(hitsBlocker(wallX, wallZ, 0.42), true, 'side wall stops lateral penetration');

  // Gloom curve & god-flight suppression
  assert.equal(cp.computeGloom({ x: slit.x + ux * 18, y: 3.5, z: slit.z + uz * 18 }), 0);
  assert.ok(cp.computeGloom({ x: slit.x - ux * 14, y: 3.2, z: slit.z - uz * 14 }) > 0.25, 'darkened deeper in elongated cave');
  cp.update({ x: slit.x - ux * 14, y: 3.2, z: slit.z - uz * 14 }, false, false);
  const shadeEl = env.doc.body.children.find((c) => c.id === 'cave-passage-gloom');
  assert.ok(shadeEl && Number(shadeEl.style.opacity) > 0.2);
  cp.update({ x: slit.x - ux * 14, y: 3.2, z: slit.z - uz * 14 }, true, false);
  assert.equal(shadeEl.style.opacity, '0', 'god-flight clears cave passage gloom');

  // Act-3 seal hides cavePassage & disables its blockers
  cp.update({ x: slit.x, y: 3.2, z: slit.z }, false, true);
  assert.equal(cp.group.visible, false, 'Act-3 seal hides cavePassage');
  assert.equal(hitsBlocker(wallX, wallZ, 0.42), false, 'Act-3 seal disables cavePassage blockers');
  cp.update({ x: slit.x, y: 3.2, z: slit.z }, false, false);
  assert.equal(cp.group.visible, true, 'Act-3 reset restores cavePassage');
  assert.equal(hitsBlocker(wallX, wallZ, 0.42), true, 'Act-3 reset restores cavePassage blockers');

  // Extended caveGleam alignment
  const gleam = createCaveGleam({ world, cliff, field, emergenceAlong: -23.0, outerMouthAlong: 15.5 });
  gleam.update(0.016, 0.5, { x: slit.x + ux * 17, y: 3.2, z: slit.z + uz * 17 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => {});
  assert.ok(gleam.group.visible && gleam.getStats().intensity > 0.35, 'extended gleam illuminates new outer mouth s=15.5');
  let bloomFired = 0;
  gleam.update(0.016, 1.0, { x: slit.x - ux * 14, y: 3.2, z: slit.z - uz * 14 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => { bloomFired++; });
  assert.equal(bloomFired, 0, 'mid-cave still dark, valley bloom waits until inner exit');
  gleam.update(0.016, 1.5, { x: slit.x - ux * 24, y: 3.2, z: slit.z - uz * 24 }, { getAppearance: () => ({ nightAmount: 0 }) }, () => { bloomFired++; });
  assert.equal(bloomFired, 1, 'emergence bloom fires past s=-23.0');

  const cgPt = scriptData.points.find((p) => p.id === 'cave-glimmer');
  const voPt = scriptData.points.find((p) => p.id === 'valley-open');
  assert.ok(cgPt.z >= 10 && voPt.z <= -30, 'script.json points match lengthened cave entrance/exit');

  gleam.dispose();
  cp.dispose();
  inst.geometry.dispose();
  inst.material.dispose();
}

// =========================================================================
// 4. Bioacoustic Multi-Formant Rooster Crow AudioBuffer Synthesis
// =========================================================================
{
  const soundSrc = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
  assert.ok(!/setTargetAtTime/.test(soundSrc), 'sound.js remains free of setTargetAtTime');

  const capturedBuffers = [];
  const capturedSources = [];
  class RichMockParam {
    constructor(v = 1) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }
  class RichMockNode {
    constructor(kind) {
      this.kind = kind;
      this.gain = new RichMockParam(1);
      this.frequency = new RichMockParam(440);
      this.Q = new RichMockParam(1);
      this.pan = new RichMockParam(0);
      this.playbackRate = new RichMockParam(1);
      this.type = 'lowpass';
      this.downstream = [];
    }
    connect(d) { this.downstream.push(d); return d; }
    disconnect() {}
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }
  class RichMockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'suspended';
      this.sampleRate = 44100;
      this.destination = new RichMockNode('dest');
    }
    createGain() { return new RichMockNode('gain'); }
    createBiquadFilter() { return new RichMockNode('filter'); }
    createStereoPanner() { return new RichMockNode('pan'); }
    createConvolver() { return new RichMockNode('conv'); }
    createOscillator() { return new RichMockNode('osc'); }
    createBufferSource() {
      const s = new RichMockNode('src');
      capturedSources.push(s);
      return s;
    }
    createDynamicsCompressor() {
      const n = new RichMockNode('comp');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new RichMockParam();
      return n;
    }
    createAnalyser() {
      const n = new RichMockNode('ana');
      n.frequencyBinCount = 1024;
      n.getByteTimeDomainData = (a) => a.fill(128);
      n.getByteFrequencyData = (a) => a.fill(0);
      return n;
    }
    createBuffer(ch, len, rate) {
      const chans = Array.from({ length: ch }, () => new Float32Array(len));
      const b = { duration: len / rate, length: len, numberOfChannels: ch, sampleRate: rate, getChannelData: (c) => chans[c] };
      capturedBuffers.push(b);
      return b;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  const rewrittenSound = soundSrc
    .replace("import world from '../data/world.json';", `const world = ${JSON.stringify(world)};`)
    .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue = { version: 1, clips: [] };')
    .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(rewrittenSound).toString('base64'));

  const env = createDomEnv();
  globalThis.document = env.doc;
  globalThis.window = { ...env.win, AudioContext: RichMockAudioContext };

  const sound = createSound({ audioCatalogue: { version: 1, clips: [] }, audioFetch: async () => ({ ok: false }) });
  assert.equal(sound.unlock(), true);
  sound.update(0.05, 1, null, { x: 28, y: 2, z: -118, yaw: 0 }, false);

  const sourcesBefore = capturedSources.length;
  assert.equal(sound.roosterCrow(28, -118), true);
  assert.equal(sound.roosterCrow(38, -124, { echo: true }), true);
  assert.equal(sound.getStats().worldSync.roosterCrows, 2);

  const roosterSrcs = capturedSources.slice(sourcesBefore);
  assert.equal(roosterSrcs.length, 2, 'roosterCrow uses synthesized AudioBufferSource (no raw oscillator chain)');
  const buf = roosterSrcs[0].buffer;
  assert.ok(buf && buf.duration >= 1.3 && buf.duration <= 1.7, `natural crow duration ~1.48s (got ${buf?.duration})`);
  const pcm = buf.getChannelData(0);
  let maxAbs = 0;
  for (let i = 0; i < pcm.length; i++) {
    assert.ok(Number.isFinite(pcm[i]), 'all synthesized PCM samples are finite');
    if (Math.abs(pcm[i]) > maxAbs) maxAbs = Math.abs(pcm[i]);
  }
  assert.ok(maxAbs > 0.5 && maxAbs <= 0.99, `synthesized crow waveform normalized (max=${maxAbs.toFixed(3)})`);

  // Count distinct RMS syllable envelopes (expect >= 3 bursts: "喔-喔-喔-喔——")
  const winSize = Math.floor(44100 * 0.02);
  let active = false;
  let burstCount = 0;
  for (let start = 0; start < pcm.length; start += winSize) {
    let sumSq = 0;
    const end = Math.min(pcm.length, start + winSize);
    for (let i = start; i < end; i++) sumSq += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumSq / (end - start));
    if (!active && rms > 0.06) { active = true; burstCount += 1; }
    else if (active && rms < 0.015) active = false;
  }
  assert.ok(burstCount >= 3, `multi-syllable rooster contour has >= 3 distinct bursts (got ${burstCount})`);
  assert.ok(roosterSrcs[1].playbackRate.value > roosterSrcs[0].playbackRate.value * 1.005 || roosterSrcs[1].downstream[0].downstream[0].frequency.value < 2000, 'echo crow differs softly in pitch/tone');
  sound.disposeSamples();
}

// =========================================================================
// 5. Rich Non-Robotic Multi-Turn Villager Conversations & Interaction UI
// =========================================================================
{
  const roleEntries = Object.entries(scriptData.npc?.roles || {});
  assert.ok(roleEntries.length >= 25, 'all 25 NPC roles present');
  for (const [role, entry] of roleEntries) {
    assert.ok(Array.isArray(entry.lines) && entry.lines.length >= 2, `${role} has >= 2 lines`);
    for (const line of entry.lines) {
      assert.ok(!/^.{1,6}(?:说|问|笑道|问道|轻声道|应着节拍道|扶了扶木刨说|顺了顺墨斗线笑道|慨然叹问|叹道|轻声叮嘱)：/.test(line), `${role} line avoids stiff "XX说：" prefix: ${line}`);
    }
  }

  const vdSrc = readFileSync(new URL('../src/systems/villager-dialogue.js', import.meta.url), 'utf8');
  for (const taboo of ['处处志', '太守', '刘子骥', '南阳', '寻向所志', '遂迷', '不复得路']) {
    assert.ok(!vdSrc.includes(taboo), `villager-dialogue.js free of Act-3 spoiler: ${taboo}`);
  }

  const env = createDomEnv();
  env.doc.body.classList.add('curtain-open');
  globalThis.document = env.doc;
  globalThis.window = env.win;

  const skyState = { timeId: 'dusk', weatherId: 'clear', rainIntensity: 0 };
  const player = {
    state: { x: 24, y: 2.0, z: -60, yaw: 0, pitch: 0, view: 'third', eyeHeight: 1.62 }
  };
  const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 200);
  cam.position.set(24, 3.8, -56);

  const mockPeople = {
    list: [{ x: 24, y: 2.0, z: -61.5, s: 1.0, role: 'weaver', mode: 'work', activity: 'weave' }],
    greet() {},
  };
  const mockFauna = { animals: [], react: () => null };
  const mockField = { sample: () => 2.0 };
  const mockSound = { voices: 0, voice() { this.voices += 1; } };
  const talkEvents = [];

  const interaction = createInteraction(
    world.interaction,
    scriptData,
    mockPeople,
    mockFauna,
    mockField,
    player,
    mockSound,
    (k, n, l) => talkEvents.push({ k, n, l })
  );

  const director = createVillagerDialogue({
    sky: skyState,
    getWorldClock: () => ({ getState: () => ({ shichenName: '酉正' }) }),
    people: mockPeople,
    sound: mockSound,
    player,
    doc: env.doc,
    win: env.win,
  });
  interaction.setDialogueDirector(director);

  interaction.update(0.016, 0.1, cam);
  assert.ok(env.getEl('prompt-text').textContent.startsWith('交谈 ·'), 'hover prompt displays 交谈 when director active');

  // Turn 0: Press E -> opens #talk with meta + 2 clickable choices
  env.win.dispatchKey('KeyE');
  const talkEl = env.getEl('talk');
  const talkMetaEl = talkEl.children.find((c) => c.id === 'talk-meta');
  const talkRepliesEl = talkEl.children.find((c) => c.id === 'talk-replies');
  assert.equal(talkEl.classList.contains('show'), true, '#talk shown on KeyE');
  assert.equal(talkEl.classList.contains('has-replies'), true, '#talk.has-replies enabled with choices');
  assert.ok(talkMetaEl?.textContent.includes('酉正'), '#talk-meta displays shichen atmosphere');
  assert.equal(talkRepliesEl?.children.length, 2, 'renders 2 reply choice buttons');

  // Turn 1: Press Digit1 -> advances branch
  const line0 = env.getEl('talk-line').textContent;
  env.win.dispatchKey('Digit1');
  const line1 = env.getEl('talk-line').textContent;
  assert.notEqual(line1, line0, 'Digit1 advances conversation to branched response');
  assert.equal(talkRepliesEl.children.length, 2, 'turn 1 offers 2 follow-up replies');

  // Turn 2: Click second reply chip -> closes conversation cleanly
  talkRepliesEl.children[1].dispatch('click');
  const line2 = env.getEl('talk-line').textContent;
  assert.notEqual(line2, line1, 'clicking reply button advances to closing remark');
  assert.equal(talkRepliesEl.children.length, 0, 'closing turn clears reply buttons');
  assert.equal(talkEl.classList.contains('has-replies'), false);

  // Repeat visit under rain -> reacts to weather and remembers prior visit
  skyState.weatherId = 'rain';
  skyState.rainIntensity = 0.85;
  interaction.update(2.2, 2.3, cam); // expire cooldown & close talk
  env.win.dispatchKey('KeyE');
  const revisitLine = env.getEl('talk-line').textContent;
  assert.ok(revisitLine.includes('又') || talkMetaEl.textContent.includes('曾叙1次'), 'remembers returning visitor');
  assert.ok(talkMetaEl.textContent.includes('细雨'), 'reacts to rainy weather');

  interaction.dispose();
}

console.log('PASS all 5 immersive upgrades (Shan-Shui ridges + twilight/KeyT sync, god-flight altitude UI, 40.5m winding cave + gleam + Act-3 seal, avian rooster AudioBuffer, multi-turn villager conversations)');
