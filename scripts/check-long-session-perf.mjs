import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createSampleAudio } from '../src/systems/sample-audio.js';
import { mapTimePalette } from '../src/systems/map-time-theme.js';
import { createMap } from '../src/systems/map.js';
import { createHeightFunction, createRiverDistance } from '../src/world/terrain.js';
import { createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';
import { Heightfield } from '../src/player/collision.js';
import { createFlora } from '../src/world/flora.js';
import { createBoats } from '../src/world/boats.js';
import { createCliff } from '../src/world/cliff.js';
import { createVillage } from '../src/world/village.js';
import { createProps } from '../src/world/props.js';
import { createHinterland, segmentDistance } from '../src/world/hinterland.js';
import { createVillageScenes } from '../src/world/village-scenes.js';
import { createVillageLife } from '../src/world/village-life.js';
import { createMysteries } from '../src/world/mysteries.js';
import { createExteriorExploration } from '../src/world/exterior-exploration.js';
import { createHabitatDetails } from '../src/world/habitat-details.js';
import { createPondLife } from '../src/world/pond-life.js';
import { createWaterworks } from '../src/world/waterworks.js';
import { createLeisureGrove } from '../src/world/leisure-grove.js';
import { createCommunityLife } from '../src/systems/community-life.js';

const worldJsonText = readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8');
const world = JSON.parse(worldJsonText);
const catalogueJsonText = readFileSync(new URL('../src/data/audio-samples.json', import.meta.url), 'utf8');
const catalogue = JSON.parse(catalogueJsonText);

async function loadCreateSound() {
  const original = readFileSync(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
  const worldUrl = 'data:text/javascript;base64,' + Buffer.from('export default ' + worldJsonText + ';').toString('base64');
  const catalogueUrl = 'data:text/javascript;base64,' + Buffer.from('export default ' + catalogueJsonText + ';').toString('base64');
  const sampleAudioFile = new URL('../src/systems/sample-audio.js', import.meta.url).href;
  // Count diagnostic snapshots without adding instrumentation to production audio.
  const sampleAudioUrl = 'data:text/javascript;base64,' + Buffer.from(`
    import { createSampleAudio as original } from ${JSON.stringify(sampleAudioFile)};
    export let statsReads = 0;
    export function createSampleAudio(options) {
      const engine = original(options);
      const getStats = engine.getStats;
      engine.getStats = () => { statsReads++; return getStats(); };
      return engine;
    }
  `).toString('base64');
  const sampleProbe = await import(sampleAudioUrl);
  const patched = original
    .replace("'../data/world.json'", JSON.stringify(worldUrl))
    .replace("'../data/audio-samples.json'", JSON.stringify(catalogueUrl))
    .replace("'./sample-audio.js'", JSON.stringify(sampleAudioUrl))
    // Read-only test hook: observe private clocks, never change scheduling logic.
    .replace('    unlock: unlock,', '    testClocks: () => ({ lfoClock, windPhase, waterPhase, timers: { ...timers }, syncState: { ...syncState } }),\n    unlock: unlock,');
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));
  return { createSound, statsReads: () => sampleProbe.statsReads };
}

function createAudioTestEnv({ initialState = 'running', keepSuspended = false } = {}) {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realRandom = Math.random;
  let randomSeed = 0x51a7;
  Math.random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 0x100000000; };
  let simMs = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const scheduledSources = new Set();
  const liveNodes = new Set();
  // Retain live graph nodes only; lifetime creation is a scalar counter, not a leak.
  let buffersCreated = 0;
  let decodeCalls = 0;
  let setTargetCalls = 0;
  let totalCreated = 0;
  let peakLive = 0;

  globalThis.setTimeout = (fn, ms = 0) => {
    const id = nextTimerId++;
    timers.set(id, { at: simMs + Math.max(0, Number(ms) || 0), fn });
    return { id, unref() { return this; } };
  };
  globalThis.clearTimeout = handle => {
    if (handle && typeof handle === 'object' && 'id' in handle) timers.delete(handle.id);
    else timers.delete(handle);
  };

  function makeParam(initial = 0) {
    let val = initial;
    const p = {
      events: [],
      writes: 0,
      get value() { return val; },
      set value(v) { val = v; p.writes++; },
      setValueAtTime(v, at) { val = v; p.events.push(['set', v, at]); },
      linearRampToValueAtTime(v, at) { val = v; p.events.push(['linear', v, at]); },
      exponentialRampToValueAtTime(v, at) { val = v; p.events.push(['exponential', v, at]); },
      setTargetAtTime(v, at, tc) { setTargetCalls++; val = v; p.events.push(['target', v, at, tc]); },
      cancelScheduledValues() {},
    };
    return p;
  }

  function makeNode(kind, extra = {}) {
    totalCreated++;
    const node = {
      kind,
      disconnected: false,
      connect() { return arguments[0]; },
      disconnect() {
        node.disconnected = true;
        liveNodes.delete(node);
        scheduledSources.delete(node);
      },
      ...extra,
    };
    liveNodes.add(node);
    if (liveNodes.size > peakLive) peakLive = liveNodes.size;
    return node;
  }

  const ctx = {
    state: initialState,
    sampleRate: 44100,
    currentTime: 0,
    destination: makeNode('destination'),
    listener: {
      positionX: makeParam(0), positionY: makeParam(0), positionZ: makeParam(0),
      forwardX: makeParam(0), forwardY: makeParam(0), forwardZ: makeParam(-1),
      upX: makeParam(0), upY: makeParam(1), upZ: makeParam(0),
      setPosition() {}, setOrientation() {},
    },
    async resume() {
      if (!keepSuspended) ctx.state = 'running';
    },
    async close() { ctx.state = 'closed'; },
    createGain() { return makeNode('gain', { gain: makeParam(1) }); },
    createBiquadFilter() { return makeNode('filter', { type: 'lowpass', frequency: makeParam(350), Q: makeParam(1), gain: makeParam(0) }); },
    createStereoPanner() { return makeNode('pan', { pan: makeParam(0) }); },
    createPanner() { return makeNode('panner3d', { panningModel: 'HRTF', positionX: makeParam(0), positionY: makeParam(0), positionZ: makeParam(0) }); },
    createConvolver() { return makeNode('convolver', { buffer: null, normalize: true }); },
    createAnalyser() {
      return makeNode('analyser', {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteTimeDomainData(a) { a.fill(128); },
        getByteFrequencyData(a) { a.fill(0); },
      });
    },
    createDynamicsCompressor() {
      return makeNode('compressor', {
        threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
        attack: makeParam(0.003), release: makeParam(0.25),
      });
    },
    createWaveShaper() { return makeNode('shaper', { curve: null, oversample: 'none' }); },
    createBuffer(channels, length, sampleRate) {
      buffersCreated++;
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      };
    },
    async decodeAudioData() {
      decodeCalls++;
      return { numberOfChannels: 1, length: 44100, sampleRate: 44100, duration: 1, getChannelData: () => new Float32Array(44100) };
    },
    createBufferSource() {
      const src = makeNode('source', {
        buffer: null,
        loop: false,
        playbackRate: makeParam(1),
        onended: null,
        _stopAt: Infinity,
        start(when = ctx.currentTime, offset = 0, duration) {
          if (!src.loop) {
            const startAt = Number.isFinite(when) ? Math.max(ctx.currentTime, when) : ctx.currentTime;
            const bufDur = src.buffer?.duration ?? 1;
            const playDur = Number.isFinite(duration) ? duration : Math.max(0.01, bufDur - (offset || 0));
            src._stopAt = Math.min(src._stopAt, startAt + playDur);
            scheduledSources.add(src);
          }
        },
        stop(when = ctx.currentTime) {
          src._stopAt = Math.min(src._stopAt, Number.isFinite(when) ? when : ctx.currentTime);
          scheduledSources.add(src);
        },
      });
      return src;
    },
    createOscillator() {
      const osc = makeNode('oscillator', {
        type: 'sine',
        frequency: makeParam(440),
        detune: makeParam(0),
        onended: null,
        _stopAt: Infinity,
        start() {},
        stop(when = ctx.currentTime) {
          osc._stopAt = Number.isFinite(when) ? when : ctx.currentTime;
          scheduledSources.add(osc);
        },
      });
      return osc;
    },
    advance(dt) {
      if (ctx.state === 'running') ctx.currentTime += dt;
      simMs += dt * 1000;
      for (const s of [...scheduledSources]) {
        if (ctx.currentTime >= s._stopAt) {
          scheduledSources.delete(s);
          liveNodes.delete(s);
          s.onended?.();
        }
      }
      for (const [id, timer] of [...timers]) {
        if (simMs >= timer.at) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    getMetrics() {
      return { setTargetCalls, totalCreated, peakLive, liveNow: liveNodes.size,
        scheduledNow: scheduledSources.size, timersNow: timers.size, buffersCreated, decodeCalls, nodes: [...liveNodes] };
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      Math.random = realRandom;
    },
  };
  return ctx;
}

const savedWindow = globalThis.window;
const savedDocument = globalThis.document;
const savedRaf = globalThis.requestAnimationFrame;
const savedCancelRaf = globalThis.cancelAnimationFrame;
const savedPath2D = globalThis.Path2D;
const savedAudioContext = globalThis.AudioContext;
const savedSetTimeout = globalThis.setTimeout;
const savedClearTimeout = globalThis.clearTimeout;
const savedRandom = Math.random;

try {
  const { createSound, statsReads } = await loadCreateSound();
  // A readiness check must not scan the catalogue or construct diagnostic snapshots.
  for (const enabled of [true, false]) {
    const engine = createSampleAudio({ config: { enabled } });
    assert.equal(typeof engine.isMuted, 'function', 'constant-time mute query is public');
    engine.getStats = () => { throw new Error('hot-path mute query must not use getStats'); };
    assert.equal(engine.isMuted(), false);
    engine.setMuted(true);
    assert.equal(engine.isMuted(), true);
    engine.setMuted(false);
    assert.equal(engine.isMuted(), false);
    engine.dispose();
    assert.equal(engine.isMuted(), false, 'sample disposal/availability does not masquerade as user mute');
  }
  const sampleClips = [
    { id: 'ack-1', category: 'voice-ack', src: 'audio/ack-1.wav' },
    { id: 'bark-1', category: 'bark', src: 'audio/bark-1.wav' },
    { id: 'chirp-1', category: 'chirp', src: 'audio/chirp-1.wav' },
  ];
  const sampleFetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });

  // 1. Suspended context check: 0 procedural/event nodes created while AudioContext stays suspended.
  {
    const suspCtx = createAudioTestEnv({ initialState: 'suspended', keepSuspended: true });
    globalThis.window = { AudioContext: function () { return suspCtx; } };
    globalThis.AudioContext = globalThis.window.AudioContext;
    const suspSound = createSound({ audioCatalogue: { version: 1, clips: sampleClips }, audioFetch: sampleFetch });
    assert.equal(suspSound.unlock(), true);
    const initNodes = suspCtx.getMetrics().totalCreated;
    const cam = { position: { x: 20, y: 2.5, z: 120 }, rotation: { y: 0 } };
    const pState = { x: 20, y: 2.5, z: 120, yaw: 0, speed: 4.5 };
    for (let f = 0; f < 1200; f++) {
      const dt = 1 / 60;
      const elapsed = f * dt;
      cam.position.x = 20 + Math.sin(elapsed * 0.4) * 18;
      pState.x = cam.position.x;
      suspSound.setAmbience({ rain: 0.75, wind: 0.6, night: 0.65 });
      if (f % 120 === 0) {
        suspSound.wood(cam.position.x + 2, cam.position.z);
        suspSound.bell(cam.position.x + 3, cam.position.z);
        suspSound.voice('elder', cam.position.x + 2, cam.position.z);
        suspSound.chirp(cam.position.x + 2, cam.position.z);
      }
      suspCtx.advance(dt);
      suspSound.update(dt, elapsed, cam, pState, false);
    }
    const afterSusp = suspCtx.getMetrics();
    assert.equal(afterSusp.totalCreated, initNodes, 'suspended context must create 0 new procedural/event nodes');
    assert.equal(afterSusp.setTargetCalls, 0, 'suspended context must make 0 setTargetAtTime calls');
    suspSound.disposeSamples();
    suspCtx.restore();
  }

  // 2. Running 10-minute (36,000-frame) WebAudio soak.
  const riverCurve = createRiverCurve(world.stream.points);
  const riverSpine = sampleRiverSpine(riverCurve, 160);
  const distanceToRiver = createRiverDistance(riverSpine);
  const heightFn = createHeightFunction(world.terrain, distanceToRiver);
  const grid = new THREE.PlaneGeometry(world.terrain.size, world.terrain.size, world.terrain.segments, world.terrain.segments);
  grid.rotateX(-Math.PI / 2);
  const heights = Float32Array.from({ length: grid.attributes.position.count }, (_, i) => heightFn(grid.attributes.position.getX(i), grid.attributes.position.getZ(i)));
  const field = new Heightfield(world.terrain.size, world.terrain.segments, heights);
  const cliff = createCliff(world.cliff, field);
  const village = createVillage(structuredClone(world.village), field, world.terrain.pond);

  let audioMetrics;
  let baseNodes = 0;
  let liveAtMin1 = 0;
  let liveAtMin10 = 0;
  let drainedLive = 0;
  let audioStats;
  let syncFrames = 0;
  let hotPathStatsReads = 0;
  let frozenCreated = 0;
  const audioTimeIds = ['dawn', 'day', 'dusk', 'night'];
  const audioTimeFrames = Object.fromEntries(audioTimeIds.map(id => [id, 0]));
  const audioSnapshots = [];
  {
    const runCtx = createAudioTestEnv({ initialState: 'suspended', keepSuspended: false });
    globalThis.window = { AudioContext: function () { return runCtx; } };
    globalThis.AudioContext = globalThis.window.AudioContext;
    let fetchCalls = 0;
    const sound = createSound({
      village,
      cliff,
      field,
      riverSpine,
      distanceToRiver,
      audioCatalogue: { version: 1, clips: sampleClips },
      audioFetch: (...args) => { fetchCalls++; return sampleFetch(...args); },
    });
    assert.equal(sound.unlock(), true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    baseNodes = runCtx.getMetrics().liveNow;
    assert.ok(baseNodes > 0, 'permanent audio graph constructed');

    const cam = { position: { x: 20, y: 2.5, z: 120 }, rotation: { y: 0 } };
    const pState = { x: 20, y: 2.5, z: 120, yaw: 0, speed: 4.2 };
    const warmSamples = sound.getStats().samples;
    assert.equal(warmSamples.load.ready, sampleClips.length, 'recordings warmed before soak');
    const sync = { rain: 0, isNight: false, timeId: 'dawn', phenology: 'summer',
      frogVisualManaged: true, sprinting: false, events: [],
      shelters: [{ x: 20, z: 120, rx: 24, rz: 24, roofY: 20, kind: 'eave' }],
      washStation: { x: 20, z: 120 }, wheel: { x: 20, z: 120, phase: 0 },
      nightFeast: { active: true, x: cliff.slit.x, z: cliff.slit.z } };
    const eventTypes = ['gateCreak', 'roosterFlap', 'roosterCrow', 'boatPole', 'poleDrip',
      'loomClack', 'mortarThud', 'waterCup', 'toastCup', 'frogPlop', 'dewDrop'];
    // Three complete dawn/day/dusk/night cycles exercise production syncWorld, not only beds.
    let lastAmbience = '';
    const anchors = [
      { x: 20, z: 120 },
      { x: cliff.slit.x, z: cliff.slit.z },
      { x: -12, z: -20 },
      { x: world.terrain.pond.x, z: world.terrain.pond.z },
    ];
    for (let f = 0; f < 36000; f++) {
      const dt = 1 / 60;
      const elapsed = f * dt;
      const seg = Math.floor(f / 3600) % anchors.length;
      const anchor = anchors[seg];
      const ang = elapsed * 0.28;
      cam.position.x = anchor.x + Math.cos(ang) * 14;
      cam.position.z = anchor.z + Math.sin(ang) * 14;
      cam.position.y = field.sample(cam.position.x, cam.position.z) + 1.65;
      cam.rotation.y = -ang;
      pState.x = cam.position.x;
      pState.y = cam.position.y - 1.65;
      pState.z = cam.position.z;
      pState.yaw = cam.rotation.y;

      const phase = (f % 4800) / 4800;
      const rain = phase > 0.35 && phase < 0.72 ? 0.75 : 0;
      const timeId = audioTimeIds[Math.floor(f / 3000) % audioTimeIds.length];
      const night = timeId === 'night' ? 0.7 : 0;
      const wind = 0.25 + 0.4 * Math.abs(Math.sin(elapsed * 0.05));
      // Match sky's quantized pushAmbience rather than resubmitting unchanged beds.
      const ambienceKey = `${rain.toFixed(2)}|${wind.toFixed(2)}|${night.toFixed(2)}`;
      if (ambienceKey !== lastAmbience) { sound.setAmbience({ rain, wind, night }); lastAmbience = ambienceKey; }
      sync.timeId = timeId;
      sync.isNight = sync.timeId === 'night';
      sync.rain = rain;
      sync.wheel.phase = elapsed * 0.3;
      sync.events.length = 0;
      if (f % 360 === 30) sync.events.push({ type: eventTypes[Math.floor(f / 360) % eventTypes.length], x: cam.position.x + 3, z: cam.position.z + 1, intensity: 0.6 });
      audioTimeFrames[sync.timeId]++;

      if (f % 240 === 60) sound.wood(cam.position.x + 4, cam.position.z + 2);
      if (f % 720 === 180) sound.bell(cam.position.x + 6, cam.position.z - 3);
      if (f % 600 === 90) sound.voice('elder', cam.position.x + 3, cam.position.z + 1);
      if (f % 540 === 150) sound.bark(cam.position.x - 4, cam.position.z + 3);
      if (f % 480 === 210) sound.chirp(cam.position.x + 5, cam.position.z - 2);

      runCtx.advance(dt);
      const readsBefore = statsReads();
      sound.update(dt, elapsed, cam, pState, false);
      sound.syncWorld(dt, sync);
      syncFrames++;
      hotPathStatsReads += statsReads() - readsBefore;

      if (f % 3600 === 3599) {
        const stats = sound.getStats();
        const metrics = runCtx.getMetrics();
        if (audioSnapshots.length) assert.equal(metrics.buffersCreated, audioSnapshots[0].buffersCreated, 'procedural buffers are cached after the first minute');
        audioSnapshots.push({ minute: (f + 1) / 3600, live: metrics.liveNow, timers: metrics.timersNow, scheduled: metrics.scheduledNow, buffersCreated: metrics.buffersCreated });
        assert.equal(fetchCalls, sampleClips.length, 'recordings are not fetched again as session ages');
        assert.equal(metrics.decodeCalls, sampleClips.length, 'recordings are not decoded again as session ages');
        assert.equal(stats.samples.decodedBytes, warmSamples.decodedBytes, 'decoded sample bytes stable');
        assert.equal(stats.samples.encodedBytes, warmSamples.encodedBytes, 'encoded sample bytes stable');
        assert.ok(stats.samples.decodedBytes <= stats.samples.budgets.maxDecodedBytes);
        assert.ok(stats.samples.encodedBytes <= stats.samples.budgets.maxEncodedBytes);
        assert.ok(stats.samples.active <= stats.samples.budgets.maxConcurrent);
        assert.ok(metrics.timersNow <= 40, `cleanup timers bounded (got ${metrics.timersNow})`);
        assert.ok(metrics.scheduledNow <= 40, `scheduled sources bounded (got ${metrics.scheduledNow})`);
      }
      if (f === 3599) liveAtMin1 = runCtx.getMetrics().liveNow;
      if (f === 35999) liveAtMin10 = runCtx.getMetrics().liveNow;
    }

    audioMetrics = runCtx.getMetrics();
    audioStats = sound.getStats();
    assert.equal(hotPathStatsReads, 0, '36,000 update + syncWorld frames must not construct sample diagnostics');
    assert.equal(syncFrames, 36000);
    for (const id of audioTimeIds) assert.equal(audioTimeFrames[id], 9000, `${id} covered in three cycles`);
    for (const counter of ['wheelCreaks', 'laundryPounds', 'gateCreaks', 'roosterCrows']) assert.ok(audioStats.worldSync[counter] > 0, `${counter} production path exercised`);
    for (const counter of ['cicadas', 'eaveDrips', 'boatPoles', 'poleDrips', 'loomClacks', 'mortarThuds', 'fouBeats']) assert.ok(audioStats.completionSync[counter] > 0, `${counter} production path exercised`);

    // Freeze repeatedly while wall/audio time advances: internal clocks, timers and events stay put.
    const clocksBefore = sound.testClocks();
    const countsBefore = audioStats.counts;
    const createdBefore = runCtx.getMetrics().totalCreated;
    for (let i = 0; i < 1800; i++) {
      runCtx.advance(1 / 60);
      sound.update(1 / 60, 600 + i / 60, cam, pState, true);
      sound.syncWorld(0, sync);
      if (i === 299) {
        const drained = runCtx.getMetrics();
        assert.equal(drained.liveNow, baseNodes, 'all transient nodes drain within five seconds');
        assert.equal(drained.timersNow, 0, 'cleanup timers drain within five seconds');
        assert.equal(drained.scheduledNow, 0, 'scheduled sources drain within five seconds');
      }
    }
    frozenCreated = runCtx.getMetrics().totalCreated - createdBefore;
    assert.equal(frozenCreated, 0, 'paused return creates no new audio nodes');
    assert.deepEqual(sound.testClocks(), clocksBefore, 'paused return freezes clocks and all event timers');
    assert.deepEqual(sound.getStats().counts, countsBefore, 'paused return does not emit or catch up events');
    assert.deepEqual(sound.getStats().worldSync, audioStats.worldSync);
    drainedLive = runCtx.getMetrics().liveNow;
    assert.equal(runCtx.getMetrics().timersNow, 0, 'all cleanup timers drain during pause');
    assert.equal(runCtx.getMetrics().scheduledNow, 0, 'all transient sources drain during pause');
    // First resumed frame uses simulation elapsed time, not the wall-time pause.
    sound.update(1 / 60, 600 + 1 / 60, cam, pState, false);
    assert.equal(sound.testClocks().lfoClock, 600 + 1 / 60);
    assert.equal(sound.getStats().counts.steps, countsBefore.steps, 'resume has no catch-up footstep');

    assert.equal(audioMetrics.setTargetCalls, 0, '0 setTargetAtTime calls across 36,000 frames');
    assert.ok(audioMetrics.peakLive - baseNodes <= 90, `peak transient nodes bounded (got ${audioMetrics.peakLive - baseNodes})`);
    // Keep the original 90-transient-node budget despite adding production world events.
    assert.ok(liveAtMin10 - liveAtMin1 <= 30, `no upward node drift from minute 1 (${liveAtMin1}) to minute 10 (${liveAtMin10})`);
    assert.equal(drainedLive, baseNodes, `all transient nodes disconnected during pause drain (got ${drainedLive}, expected ${baseNodes})`);

    sound.disposeSamples();
    runCtx.restore();
  }

  // 3. Direct createSampleAudio stationary-listener optimization check.
  {
    const sCtx = createAudioTestEnv({ initialState: 'suspended', keepSuspended: false });
    const engine = createSampleAudio({
      catalogue: { version: 1, clips: sampleClips },
      fetch: sampleFetch,
      baseUrl: 'https://example.test/garden/',
    });
    engine.attach(sCtx, sCtx.destination);
    assert.equal(await engine.unlock(), true);
    assert.equal(engine.play('bark', { x: 18, z: 4, emitterId: 'dog-0' }), true);
    const created = sCtx.getMetrics().nodes;
    const panNode = created.find(n => n.kind === 'pan');
    const filterNode = created.find(n => n.kind === 'filter');
    const gainNode = created.filter(n => n.kind === 'gain').at(-1);
    engine.setListener({ x: 5, z: 1, yaw: 0.4 });
    const panBefore = { writes: panNode.pan.writes, events: panNode.pan.events.length };
    const freqBefore = { writes: filterNode.frequency.writes, events: filterNode.frequency.events.length };
    const gainBefore = { writes: gainNode.gain.writes, events: gainNode.gain.events.length };
    for (let i = 0; i < 600; i++) {
      engine.setListener({ x: 5, z: 1, yaw: 0.4 });
    }
    assert.equal(panNode.pan.writes, panBefore.writes, 'stationary listener does not rewrite pan');
    assert.equal(filterNode.frequency.writes, freqBefore.writes, 'stationary listener does not rewrite frequency');
    assert.equal(gainNode.gain.writes, gainBefore.writes, 'stationary listener does not rewrite gain');
    assert.equal(panNode.pan.events.length, panBefore.events);
    assert.equal(filterNode.frequency.events.length, freqBefore.events);
    assert.equal(gainNode.gain.events.length, gainBefore.events);
    assert.equal(sCtx.getMetrics().setTargetCalls, 0, 'sample-audio never calls setTargetAtTime');
    engine.dispose();
    sCtx.restore();
  }

  // 4. World + Map 10-minute (36,000-frame) soak check.
  let miniDrawsDuringBlend = 0;
  class MockCanvasContext {
    constructor(isMinimap = false) {
      this.isMinimap = isMinimap;
      this.globalAlpha = 1;
      this.fillStyle = '#000';
      this.strokeStyle = '#000';
      this.lineWidth = 1;
      this.font = '12px serif';
      this.textAlign = 'left';
      this.textBaseline = 'alphabetic';
      this.stack = [];
    }
    save() { this.stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); }
    restore() { Object.assign(this, this.stack.pop() || {}); }
    clearRect() { if (this.isMinimap) miniDrawsDuringBlend++; }
    fillRect() {}
    strokeRect() {}
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    arc() {}
    ellipse() {}
    rect() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    fill() {}
    stroke() {}
    clip() {}
    setTransform() {}
    translate() {}
    rotate() {}
    scale() {}
    setLineDash() {}
    fillText() {}
    strokeText() {}
    drawImage() {}
    putImageData() {}
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
    createRadialGradient() { return { addColorStop() {} }; }
    createLinearGradient() { return { addColorStop() {} }; }
    measureText(s) { return { width: (s?.length || 0) * 10 }; }
  }
  class MockEl {
    constructor(id = '') {
      this.id = id;
      this.tagName = id.includes('canvas') ? 'CANVAS' : 'DIV';
      this.children = [];
      this.width = 300;
      this.height = 150;
      this.clientWidth = 1200;
      this.clientHeight = 500;
      this.textContent = '';
      this.innerHTML = '';
      this.style = { setProperty() {} };
      const cls = new Set();
      this.classList = {
        add: k => cls.add(k),
        remove: k => cls.delete(k),
        contains: k => cls.has(k),
        toggle: (k, f) => (f === undefined ? (cls.has(k) ? (cls.delete(k), false) : (cls.add(k), true)) : (f ? (cls.add(k), true) : (cls.delete(k), false))),
      };
      if (this.tagName === 'CANVAS') this.ctx2d = new MockCanvasContext(id === 'minimap-canvas');
    }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute() {}
    addEventListener() {}
    removeEventListener() {}
    getContext() { return this.ctx2d || (this.ctx2d = new MockCanvasContext(false)); }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }
  const mapIds = new Map(
    ['map', 'map-sheet', 'map-canvas', 'map-close', 'map-list', 'map-region', 'map-dest', 'map-count',
      'map-note-name', 'map-note-poem', 'map-dist', 'minimap', 'minimap-canvas', 'minimap-region',
      'toast', 'toast-k', 'toast-name'].map(id => [id, new MockEl(id)])
  );
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    getElementById: id => mapIds.get(id) || null,
    createElement: tag => new MockEl(tag === 'canvas' ? 'offscreen-canvas' : tag),
    body: new MockEl('body'),
    pointerLockElement: null,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.Path2D = class { moveTo() {} lineTo() {} };

  const basin = world.terrain.basin;
  const floraField = {
    half: field.half,
    sample: (x, z) => field.sample(x, z),
    slope: (x, z) => Math.hypot(x - basin.x, z - basin.z) < basin.inner * 1.05 ? 9 : field.slope(x, z),
  };
  const near = (x, z) => Math.hypot(x - world.player.spawn.x, z - world.player.spawn.z) < 34
    || Math.hypot(x - cliff.slit.x, z - cliff.slit.z) < 40
    || world.village.road.points.some((p, i, a) => i && segmentDistance(x, z, a[i - 1], p) < 20);
  const flora = createFlora(world.flora, floraField, distanceToRiver, riverCurve, world.player.spawn, near);
  const streamStub = { surfaceY: () => world.terrain.waterLevel };
  const boats = createBoats(world.boats, streamStub, world.terrain, riverCurve, field);
  const props = createProps(world.props, field, village.houseInfo, village.plots, village.road);
  const hinterland = createHinterland(world.hinterland, field, distanceToRiver, world, village, props, cliff);
  const villageScenes = createVillageScenes(world, field, distanceToRiver, village, props, cliff, hinterland);
  const mysteryWorld = createMysteries(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, flora);
  const villageLife = createVillageLife(world, field, distanceToRiver, village, props, cliff, hinterland, villageScenes, mysteryWorld);
  const exterior = createExteriorExploration(world, field, distanceToRiver, riverCurve, flora, boats, cliff);
  const communityOptions = {
    world, field, distanceToRiver, riverCurve, stream: streamStub, flora, hinterland, village,
    villageScenes, villageLife, mysteryWorld, props, boats, cliff, exterior,
  };
  communityOptions.habitatDetails = createHabitatDetails(communityOptions);
  const pondLife = createPondLife({ ...communityOptions, reservations: [] });
  const waterworks = createWaterworks({ ...communityOptions, reservations: [pondLife] });
  const leisureGrove = createLeisureGrove({ ...communityOptions, reservations: [pondLife, waterworks] });
  const colliders = cliff.blockers.concat(
    village.blockers, hinterland.blockers, villageScenes.blockers, mysteryWorld.blockers,
    villageLife.blockers, exterior.blockers, pondLife.blockers, waterworks.blockers, leisureGrove.blockers
  );
  const communityLife = createCommunityLife({
    world,
    field,
    stations: [...pondLife.stations, ...waterworks.stations, ...leisureGrove.stations],
    sound: { wood() {} },
    blockers: colliders,
  });

  const player = { state: { x: -12, z: -20, yaw: 0 }, clearInput() {} };
  const mapApi = createMap(world.map, world, {
    field,
    spots: flora.spots,
    houseInfo: village.houseInfo,
    marks: props.marks,
    bamboo: village.bamboo,
    mulberry: village.mulberry,
    hinterland,
    villageScenes: villageScenes.mapData,
    villageLife: villageLife.mapData,
    pond: village.pond,
    chimneys: village.chimneys,
    spine: riverSpine,
    canvas: null,
    player,
    exterior: exterior.mapData,
    pondLife: pondLife.layout,
    waterworks: waterworks.layout,
    leisureGrove: leisureGrove.layout,
    visited: [],
    onVisit() {},
  });

  // Verify getInteractables array reuse.
  assert.equal(communityLife.getInteractables(), communityLife.getInteractables(), 'communityLife.getInteractables reuses array');

  // Verify 480-frame day->dusk blend throttles minimap redraws while drawing frame 1 and settling cleanly.
  mapApi.update(1 / 60);
  miniDrawsDuringBlend = 0;
  mapApi.setTimeAppearance('dusk', 1 / 60, 'clear');
  for (let i = 0; i < 480; i++) {
    if (i === 1) assert.ok(miniDrawsDuringBlend >= 1, 'frame 1 of new timeId draws immediately');
    mapApi.update(1 / 60);
  }
  assert.ok(miniDrawsDuringBlend <= 160, `minimap redraws throttled during blend (got ${miniDrawsDuringBlend})`);
  const blendMiniDraws = miniDrawsDuringBlend;
  const duskGoal = mapTimePalette(world.map.palette, 'dusk');
  assert.equal(mapApi.getStats().appearance.paper.toLowerCase(), duskGoal.paper.toLowerCase(), 'dusk blend settled cleanly');

  // Warmup 600 frames + timed 36,000-frame soak.
  const sky = { night: 0, rain: 0 };
  const pState = { x: -12, y: 2.5, z: -20, yaw: 0 };
  const timeCycle = ['day', 'dusk', 'night', 'dawn'];
  for (let w = 0; w < 600; w++) {
    const dt = 1 / 60;
    waterworks.update(dt, w * dt, sky);
    leisureGrove.update(dt, w * dt, sky);
    communityLife.update(dt, w * dt, sky, pState);
    communityLife.getInteractables();
    mapApi.update(dt);
  }

  let min1Ms = 0;
  let min10Ms = 0;
  const soakStart = performance.now();
  for (let f = 0; f < 36000; f++) {
    const dt = 1 / 60;
    const elapsed = (f + 600) * dt;
    const ti = Math.floor(f / 3600) % timeCycle.length;
    const timeId = timeCycle[ti];
    sky.night = timeId === 'night' ? 0.9 : timeId === 'dusk' ? 0.35 : 0;
    sky.rain = (f % 4800) > 2400 ? 0.7 : 0;
    player.state.x = -12 + Math.cos(elapsed * 0.2) * 28;
    player.state.z = -20 + Math.sin(elapsed * 0.2) * 28;
    player.state.yaw = elapsed * 0.3;
    pState.x = player.state.x;
    pState.z = player.state.z;
    pState.yaw = player.state.yaw;

    const t0 = f < 3600 || f >= 32400 ? performance.now() : 0;
    waterworks.update(dt, elapsed, sky);
    leisureGrove.update(dt, elapsed, sky);
    communityLife.update(dt, elapsed, sky, pState);
    communityLife.getInteractables();
    mapApi.setTimeAppearance(timeId, dt, sky.rain > 0.2 ? 'rain' : 'clear');
    mapApi.update(dt);
    if (f < 3600) min1Ms += performance.now() - t0;
    else if (f >= 32400) min10Ms += performance.now() - t0;
  }
  const soakTotalMs = performance.now() - soakStart;
  const min1AvgMs = min1Ms / 3600;
  const min10AvgMs = min10Ms / 3600;

  assert.ok(waterworks.getStats().impacts > 0, 'waterworks mortar impacts active');
  for (const grp of [waterworks.group, leisureGrove.group, communityLife.group]) {
    grp.traverse(obj => {
      if (obj.isInstancedMesh && obj.instanceMatrix?.array) {
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${obj.name || 'instanced'} matrix finite`);
      }
    });
  }
  assert.ok(min10AvgMs <= Math.max(min1AvgMs * 2.0, min1AvgMs + 0.2), `minute-10 avg (${min10AvgMs.toFixed(4)}ms) stayed flat vs minute-1 (${min1AvgMs.toFixed(4)}ms)`);

  mapApi.dispose();
  communityLife.dispose();
  leisureGrove.dispose();
  waterworks.dispose();
  pondLife.dispose();
  exterior.dispose?.();
  mysteryWorld.dispose?.();
  villageScenes.dispose?.();
  hinterland.dispose?.();
  props.dispose?.();
  boats.dispose?.();
  flora.dispose?.();

  console.log(JSON.stringify({
    pass: true,
    audio: {
      baseNodes,
      setTargetCalls: audioMetrics.setTargetCalls,
      totalCreated: audioMetrics.totalCreated,
      peakLive: audioMetrics.peakLive,
      liveAtMin1,
      liveAtMin10,
      liveNow: audioMetrics.liveNow,
      drainedLive,
      syncFrames, audioTimeFrames, hotPathStatsReads, frozenCreated, audioSnapshots,
      sampleDecodedBytes: audioStats.samples.decodedBytes,
      sampleEncodedBytes: audioStats.samples.encodedBytes,
      completion: audioStats.completionSync,
    },
    worldAndMap: {
      blendMiniDraws,
      soakMiniDraws: miniDrawsDuringBlend,
      waterworksImpacts: waterworks.getStats().impacts,
      min1AvgMs: +min1AvgMs.toFixed(4),
      min10AvgMs: +min10AvgMs.toFixed(4),
      soakTotalMs: Math.round(soakTotalMs),
    },
  }));
} finally {
  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
  globalThis.requestAnimationFrame = savedRaf;
  globalThis.cancelAnimationFrame = savedCancelRaf;
  globalThis.Path2D = savedPath2D;
  globalThis.AudioContext = savedAudioContext;
  globalThis.setTimeout = savedSetTimeout;
  globalThis.clearTimeout = savedClearTimeout;
  Math.random = savedRandom;
}
