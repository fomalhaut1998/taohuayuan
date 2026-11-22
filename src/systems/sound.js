import world from '../data/world.json';
import catalogue from '../data/audio-samples.json';
import { createSampleAudio } from './sample-audio.js';

// Human/animal one-shots are local recordings; regional weather and footsteps remain procedural.
// Missing/failed recordings are deliberately silent. Dialogue/text is never changed here.
const SC = world.sound || {};
const BEDS = SC.beds || {};
const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
const rand = function (a, b) { return a + Math.random() * (b - a); };
const smoothstep = function (a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;
const AUDIO_STORAGE_KEY = 'taohua.audio.v1';
const AUDIO_MODES = [
  { mode: 'full', volume: 1.0, muted: false, label: '畅响', toast: '雅音 · 畅响 · 山水清音' },
  { mode: 'soft', volume: 0.42, muted: false, label: '轻音', toast: '雅音 · 轻音 · 半敛清响' },
  { mode: 'mute', volume: 0.0, muted: true, label: '寂静', toast: '雅音 · 寂静 · 万籁俱寂' }
];
const DEFAULT_AUDIO_MODE = AUDIO_MODES.find(m => m.mode === 'soft') || AUDIO_MODES[0];

export function createSound(deps) {
  deps = deps || {};

  let ctx = null;
  let ready = false;
  let master = null;
  let sampleBus = null;
  let sampleCaveSend = null;
  let analyser = null;
  let revSend = null;
  let caveSend = null;
  let noise = null;
  let beds = null;
  let started = false;
  let lastFrozen = false;

  const baseMasterGain = SC.master === undefined ? 0.72 : SC.master;
  let userMode = DEFAULT_AUDIO_MODE.mode;
  let userVolume = DEFAULT_AUDIO_MODE.volume;
  let userMuted = DEFAULT_AUDIO_MODE.muted;
  try {
    const rawPrefs = globalThis.localStorage?.getItem?.(AUDIO_STORAGE_KEY);
    if (rawPrefs) {
      const parsed = JSON.parse(rawPrefs);
      if (parsed && typeof parsed === 'object') {
        const found = AUDIO_MODES.find(m => m.mode === parsed.mode);
        if (found) userMode = found.mode;
        if (Number.isFinite(Number(parsed.volume))) {
          userVolume = clamp(Number(parsed.volume), 0, 1);
        } else if (found) {
          userVolume = found.volume;
        }
        if (typeof parsed.muted === 'boolean') {
          userMuted = parsed.muted;
        } else {
          userMuted = Boolean((found && found.muted) || userVolume <= 0.001);
        }
      }
    }
  } catch (_) {}

  function saveAudioPrefs() {
    try {
      globalThis.localStorage?.setItem?.(
        AUDIO_STORAGE_KEY,
        JSON.stringify({ mode: userMode, volume: userVolume, muted: userMuted })
      );
    } catch (_) {}
  }

  function effectiveMasterGain() {
    return (userMuted || userVolume <= 0.001) ? 0 : baseMasterGain * userVolume;
  }

  const ambience = { rain: 0, wind: 0.28, night: 0 };
  const region = { river: 0, pond: 0, cave: 0, village: 0, cascade: 0, brook: 0, pineRidge: 0 };
  const stats = { voices: 0, clucks: 0, barks: 0, chirps: 0, lows: 0, quacks: 0, steps: 0, drips: 0, clatters: 0, drops: 0, gurgles: 0, frogs: 0, rustles: 0 };
  const stepMaterials = { grass: 0, dirt: 0, stone: 0, wood: 0, water: 0, snow: 0 };
  const worldSync = {
    laundryPounds: 0, wheelCreaks: 0, gateCreaks: 0, roosterCrows: 0, roosterFlaps: 0, gathers: 0,
    eaveDrips: 0, boatPoles: 0, poleDrips: 0, fouBeats: 0, cicadas: 0,
    waterCups: 0, toasts: 0, stagCalls: 0, loomClacks: 0, mortarThuds: 0, stoolSits: 0,
    frogPlops: 0, dewDrops: 0,
    cascadeSplashes: 0, craneCalls: 0, goatBleats: 0, teaSimmers: 0,
    plowScrapes: 0, oxLows: 0,
    stoneSkips: 0, canopyRains: 0, goStoneClicks: 0, kilnCrackles: 0, portalBlooms: 0,
    raftKnocks: 0, netRustles: 0, snowSteps: 0, springDrips: 0
  };
  const syncState = {
    laundryTimer: 1.4, lastWheelHalf: null, frogHush: 0, frogPlopCooldown: 0, shelter: 0, eaveDripTimer: 0.35,
    fouTimer: 0.7, fouStep: 0, quietExplicit: false, quietSync: false, quietStill: false, quietBlend: 0,
    phenology: 'spring', timeId: '', cicadaTimer: 1.8, snow: 0,
    tunnelOcclusion: 0, wasDeepInTunnel: false, portalBloom: 1, portalBloomCooldown: 0, skiffCanopy: 0
  };
  const timers = {
    drip: 1.4, clatter: 2.4, chatter: 6.5, bird: 2.8, cricket: 0.7,
    drop: 0.25, gurgle: 2.6, frog: 3.8, gust: 1.1, dog: 16,
    cascadeSplash: 1.9, crane: 9.2, goat: 7.8, teaSimmer: 1.8,
    goStone: 6.4, kilnCrackle: 2.8, coldSpring: 1.9, poeticMusic: 9.5
  };
  const poeticMusic = {
    phrases: 0,
    valleyEmergences: 0,
    lastInstrument: 'none',
    lostMood: false
  };

  const listener = { x: 0, z: 0, y: 0, yaw: 0 };
  const pageUrl = globalThis.document?.baseURI || globalThis.location?.href || 'http://localhost/';
  const baseUrl = new URL(import.meta.env?.BASE_URL || './', pageUrl).href;
  let samples = createSampleAudio({ catalogue: deps.audioCatalogue || catalogue, config: SC.samples, baseUrl, fetch: deps.audioFetch || globalThis.fetch });
  if (userMuted || userVolume <= 0.001) samples.setMuted(true);
  let lastX = null;
  let lastZ = null;
  let stepDist = 0;
  let wasAirborne = false;
  let hasListener = false;
  const bedState = Object.create(null);
  let stepSide = 1;
  let windPhase = Math.random() * 10;
  let waterPhase = Math.random() * 10;
  let villageCenter = null;
  let villageRadius = 84;
  let cavePos = null;
  let lastLevel = 0;

  // ---- 世界里的几个声音中心：村子、洞口。没有传就退化为无人声的环境音。 ----
  const houses = (deps.village && deps.village.houseInfo) ? deps.village.houseInfo : [];
  if (houses.length) {
    let sx = 0, sz = 0;
    for (let i = 0; i < houses.length; i++) { sx += houses[i].x; sz += houses[i].z; }
    villageCenter = { x: sx / houses.length, z: sz / houses.length };
    let r = 0;
    for (let i = 0; i < houses.length; i++) {
      const d = Math.hypot(houses[i].x - villageCenter.x, houses[i].z - villageCenter.z);
      if (d > r) r = d;
    }
    villageRadius = r + 14;
  }
  if (deps.cliff && deps.cliff.slit) cavePos = { x: deps.cliff.slit.x, z: deps.cliff.slit.z };
  const pond = world.terrain && world.terrain.pond ? world.terrain.pond : null;

  // 谷内四境边地声学锚点：北涧三叠飞泉与清渠、东皋苍松观云岭、西坞山泉茶灶与牧羊坡
  const borderlandAnchors = {
    cascade: { x: 26.0, z: -246.5 },
    brook: [[26.0, -246.0], [25.2, -238.5], [24.5, -230.0], [24.5, -224.0], [26.2, -218.0], [30.5, -214.6], [33.3, -213.2], [34.3, -210.9], [38.2, -208.0], [43.5, -206.8], [48.0, -206.6], [49.4, -206.5]],
    pineRidges: [
      { x: 122.0, z: -170.0, r: 44.0 },
      { x: 112.0, z: -136.0, r: 36.0 },
      { x: -34.0, z: -222.0, r: 38.0 }
    ],
    teaStove: { x: -14.2, z: -222.2 },
    mountainTea: { x: 82.0, z: -235.5 },
    lanke: { x: 156.0, z: -164.0 },
    kiln: { x: 136.5, z: -221.5 },
    eastPasture: { x: 92.5, z: -153.5 },
    stoneSpots: [
      { x: 24.5, z: -224.0, r: 2.9 },  // 北涧青石板桥
      { x: 124.5, z: -170.0, r: 3.2 }, // 东皋观云亭六角石坪
      { x: 20.2, z: -242.0, r: 2.2 }   // 北涧观瀑圆石台
    ],
    flagstoneTrails: [
      [[94.0, -196.0], [97.5, -182.5], [98.0, -169.5], [108.5, -170.5], [117.5, -170.2], [121.2, -170.0]],
      [[98.0, -169.5], [95.5, -156.0], [104.0, -149.5], [116.5, -150.0], [124.8, -150.5]],
      [[19.5, -224.0], [19.0, -233.5], [20.2, -242.0]]
    ],
    dirtTrails: [
      [[95.5, -156.0], [89.5, -148.0], [83.5, -144.0]],
      [[82.0, -215.0], [66.0, -214.5], [46.0, -214.5], [32.5, -219.5], [24.5, -224.0], [15.5, -223.8], [2.0, -223.0], [-13.5, -220.5], [-24.0, -206.0], [-30.0, -188.0]],
      [[-13.5, -220.5], [-26.5, -225.0], [-38.5, -222.5], [-45.0, -212.0]]
    ],
    _syncedPaths: null
  };
  const lastBrookPt = { x: 24.5, z: -224.0 };
  const activePineAnchor = { x: 122.0, z: -170.0 };

  function syncBorderlandLayout(lay) {
    if (!lay || typeof lay !== 'object') return;
    if (lay.waterfall && Number.isFinite(lay.waterfall.poolX) && Number.isFinite(lay.waterfall.poolZ)) {
      borderlandAnchors.cascade.x = lay.waterfall.poolX;
      borderlandAnchors.cascade.z = lay.waterfall.poolZ;
    }
    if (lay.brook && Array.isArray(lay.brook.points) && lay.brook.points.length >= 2) {
      borderlandAnchors.brook = lay.brook.points;
    }
    if (lay.teaStove && Number.isFinite(lay.teaStove.x) && Number.isFinite(lay.teaStove.z)) {
      borderlandAnchors.teaStove.x = lay.teaStove.x;
      borderlandAnchors.teaStove.z = lay.teaStove.z;
    }
    if (lay.eastPasture && Number.isFinite(lay.eastPasture.x) && Number.isFinite(lay.eastPasture.z)) {
      borderlandAnchors.eastPasture.x = lay.eastPasture.x;
      borderlandAnchors.eastPasture.z = lay.eastPasture.z;
    }
    if (lay.cloudPavilion && Number.isFinite(lay.cloudPavilion.x) && Number.isFinite(lay.cloudPavilion.z)) {
      borderlandAnchors.pineRidges[0].x = lay.cloudPavilion.x - 2.5;
      borderlandAnchors.pineRidges[0].z = lay.cloudPavilion.z;
      borderlandAnchors.stoneSpots[1].x = lay.cloudPavilion.x;
      borderlandAnchors.stoneSpots[1].z = lay.cloudPavilion.z;
    }
    if (lay.stoneBridge && Number.isFinite(lay.stoneBridge.x) && Number.isFinite(lay.stoneBridge.z)) {
      borderlandAnchors.stoneSpots[0].x = lay.stoneBridge.x;
      borderlandAnchors.stoneSpots[0].z = lay.stoneBridge.z;
    }
    if (Array.isArray(lay.paths) && lay.paths !== borderlandAnchors._syncedPaths) {
      borderlandAnchors._syncedPaths = lay.paths;
      const fs = [];
      const dt = [];
      for (let i = 0; i < lay.paths.length; i++) {
        const p = lay.paths[i];
        if (!p || !Array.isArray(p.points) || p.points.length < 2) continue;
        if (p.kind === 'flagstone') fs.push(p.points);
        else dt.push(p.points);
      }
      if (fs.length) borderlandAnchors.flagstoneTrails = fs;
      if (dt.length) borderlandAnchors.dirtTrails = dt;
    }
  }
  if (deps.valleyBorderlands?.layout) syncBorderlandLayout(deps.valleyBorderlands.layout);

  // 三处深谷静修锚点：北涧冷泉竹笕、东南碧涧茶坞泥灶与源泉
  const deepHollowAnchors = {
    coldSpring: { x: 55.3, z: -295.8 },
    teaStove: { x: 185.8, z: -114.5 },
    jadeRill: { x: 181.6, z: -118.8 },
    ancientAltar: { x: -124.0, z: -116.0 }
  };
  const tmpTeaOpts = { gainScale: 1, withEmberCrackle: false };
  const tmpSpringOpts = { gainScale: 1 };

  function syncDeepHollowsLayout(lay) {
    const sa = lay?.soundAnchors;
    if (!sa || typeof sa !== 'object') return;
    if (sa.coldSpring && Number.isFinite(sa.coldSpring.x) && Number.isFinite(sa.coldSpring.z)) {
      deepHollowAnchors.coldSpring.x = sa.coldSpring.x;
      deepHollowAnchors.coldSpring.z = sa.coldSpring.z;
    }
    if (sa.teaStove && Number.isFinite(sa.teaStove.x) && Number.isFinite(sa.teaStove.z)) {
      deepHollowAnchors.teaStove.x = sa.teaStove.x;
      deepHollowAnchors.teaStove.z = sa.teaStove.z;
    }
    if (sa.jadeRill && Number.isFinite(sa.jadeRill.x) && Number.isFinite(sa.jadeRill.z)) {
      deepHollowAnchors.jadeRill.x = sa.jadeRill.x;
      deepHollowAnchors.jadeRill.z = sa.jadeRill.z;
    }
    if (sa.ancientAltar && Number.isFinite(sa.ancientAltar.x) && Number.isFinite(sa.ancientAltar.z)) {
      deepHollowAnchors.ancientAltar.x = sa.ancientAltar.x;
      deepHollowAnchors.ancientAltar.z = sa.ancientAltar.z;
    }
  }
  if (deps.deepHollows?.layout) syncDeepHollowsLayout(deps.deepHollows.layout);

  function now() { return ctx ? ctx.currentTime : 0; }

  function canRunProcedural() {
    return Boolean(ready && ctx && noise && (!ctx.state || ctx.state === 'running'));
  }

  function canPlayProcedural() {
    return Boolean(canRunProcedural() && master && master.gain.value > 0 && !samples.isMuted());
  }

  function resetBedState() {
    for (const key of Object.keys(bedState)) delete bedState[key];
  }

  function smoothBed(key, param, value, dt, tc, immediate) {
    if (!param) return;
    const targetVal = Math.max(0, Number.isFinite(value) ? value : 0);
    const prev = bedState[key];
    if (immediate || prev === undefined) {
      bedState[key] = targetVal;
      param.value = targetVal;
      return;
    }
    const step = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.25);
    const alpha = 1 - Math.exp(-step / Math.max(0.01, tc || 0.22));
    const blended = prev + (targetVal - prev) * alpha;
    const next = Math.abs(targetVal - blended) < 0.00015 ? targetVal : blended;
    if (Math.abs(next - prev) < 0.0001 && next !== targetVal) return;
    if (next === prev) return;
    bedState[key] = next;
    param.value = next;
  }

  function disconnectNodes(nodes) {
    if (!nodes || !nodes.length) return;
    for (let i = 0; i < nodes.length; i++) {
      try { nodes[i].disconnect(); } catch (err) {}
    }
  }

  // 一次性音效结束后把节点从音频图上摘下来，避免长时间游玩后节点越积越多
  function autoDisconnect(nodes, seconds, sourceNode) {
    if (!nodes || !nodes.length) return;
    let done = false;
    let timer = null;
    const cleanup = function () {
      if (done) return;
      done = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      disconnectNodes(nodes);
    };
    if (sourceNode) sourceNode.onended = cleanup;
    timer = setTimeout(cleanup, Math.max(0.15, seconds) * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function pannerNode() {
    if (ctx.createStereoPanner) return ctx.createStereoPanner();
    return null;
  }

  function makeIR(seconds, decay) {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, decay);
        const white = Math.random() * 2 - 1;
        lp = lp * 0.64 + white * 0.36;
        d[i] = lp * env;
      }
      // 洞壁的早期反射：几个稀疏的拍点，让空间有「石壁」的轮廓
      const taps = ch === 0
        ? [[0.013, 0.55], [0.031, 0.36], [0.058, 0.22], [0.091, 0.14]]
        : [[0.019, 0.48], [0.041, 0.32], [0.072, 0.20], [0.109, 0.12]];
      for (let k = 0; k < taps.length; k++) {
        const idx = Math.floor(taps[k][0] * sr);
        if (idx < n) d[idx] += (Math.random() * 2 - 1) * taps[k][1];
      }
    }
    return buf;
  }

  // 无缝循环噪声：把尾巴和开头交叉淡化，再从交叉段末尾接回开头。
  // 这样循环点两侧是相邻样本，不会每几秒「咔」一下。
  function makeNoise(kind, seconds) {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const fade = Math.min(Math.floor(sr * 0.3), Math.floor(n * 0.12));
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(n);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        let v;
        if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520;
          b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.0168980;
          v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else if (kind === 'brown') {
          brown = (brown + 0.02 * w) / 1.02;
          v = brown * 3.4;
        } else {
          v = w;
        }
        raw[i] = clamp(v, -1, 1);
      }
      for (let j = 0; j < fade; j++) {
        const t = j / fade;
        const s = t * t * (3 - 2 * t);
        const idx = n - fade + j;
        raw[idx] = raw[idx] * (1 - s) + raw[j] * s;
      }
      buf.getChannelData(ch).set(raw);
    }
    buf._loopStart = fade / sr;
    return buf;
  }

  function loopSource(buf) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = buf._loopStart || 0;
    s.loopEnd = buf.duration;
    s.start(0, buf._loopStart || 0);
    return s;
  }

  function makeBed(buf, spec) {
    const src = loopSource(buf);
    let node = src;
    let filter = null;
    if (spec.hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = spec.hp;
      f.Q.value = spec.q || 0.65;
      node.connect(f); node = f; filter = f;
    }
    if (spec.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = spec.lp;
      f.Q.value = spec.q || 0.65;
      node.connect(f); node = f; filter = f;
    }
    if (spec.bp) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = spec.bp;
      f.Q.value = spec.q || 0.8;
      node.connect(f); node = f; filter = f;
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g);
    const p = pannerNode();
    if (p) { g.connect(p); p.connect(master); } else { g.connect(master); }
    return { src: src, node: g, gain: g.gain, panner: p, pan: p ? p.pan : null, filter: filter };
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = effectiveMasterGain();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;

    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    // 两套混响：日常的「小空间」和洞里更长的石壁回声
    revSend = ctx.createGain();
    revSend.gain.value = 0.3;
    const smallConv = ctx.createConvolver();
    smallConv.buffer = makeIR(0.85, 3.0);
    const smallWet = ctx.createGain();
    smallWet.gain.value = SC.reverb && SC.reverb.small !== undefined ? SC.reverb.small : 0.22;
    revSend.connect(smallConv); smallConv.connect(smallWet); smallWet.connect(master);

    caveSend = ctx.createGain();
    caveSend.gain.value = 0.06;
    const caveConv = ctx.createConvolver();
    caveConv.buffer = makeIR(2.7, 2.05);
    const caveWet = ctx.createGain();
    caveWet.gain.value = SC.reverb && SC.reverb.cave !== undefined ? SC.reverb.cave : 0.38;
    caveSend.connect(caveConv); caveConv.connect(caveWet); caveWet.connect(master);

    sampleBus = ctx.createGain();
    sampleBus.gain.value = 1.0;
    sampleBus.connect(master);
    sampleCaveSend = ctx.createGain();
    sampleCaveSend.gain.value = 0;
    sampleBus.connect(sampleCaveSend);
    sampleCaveSend.connect(caveSend);

    samples.attach(ctx, sampleBus);
    if (userMuted || userVolume <= 0.001) samples.setMuted(true);
    return true;
  }

  function applyMasterGain(frozenFlag) {
    const eff = effectiveMasterGain();
    if (master) master.gain.value = eff;
    const mutedNow = Boolean(frozenFlag || userMuted || userVolume <= 0.001 || eff <= 0);
    samples.setMuted(mutedNow);
    if (mutedNow) stopActiveCrows();
  }

  function getAudioPrefs() {
    const spec = AUDIO_MODES.find(m => m.mode === userMode) || DEFAULT_AUDIO_MODE;
    return {
      mode: spec.mode,
      volume: userVolume,
      muted: Boolean(userMuted || userVolume <= 0.001),
      label: spec.label,
      toast: spec.toast
    };
  }

  function setUserVolume(vol) {
    userVolume = clamp(Number.isFinite(Number(vol)) ? Number(vol) : DEFAULT_AUDIO_MODE.volume, 0, 1);
    if (userVolume <= 0.001) {
      userMuted = true;
      userMode = 'mute';
    } else {
      userMuted = false;
      userMode = userVolume < 0.72 ? 'soft' : 'full';
    }
    saveAudioPrefs();
    applyMasterGain(lastFrozen);
    return getAudioPrefs();
  }

  function setUserMuted(muted) {
    userMuted = Boolean(muted);
    if (userMuted) {
      userMode = 'mute';
    } else {
      if (userVolume <= 0.001) userVolume = DEFAULT_AUDIO_MODE.volume;
      userMode = userVolume < 0.72 ? 'soft' : 'full';
    }
    saveAudioPrefs();
    applyMasterGain(lastFrozen);
    return getAudioPrefs();
  }

  function cycleAudioMode(dir = 1) {
    const curIdx = AUDIO_MODES.findIndex(m => m.mode === userMode);
    const stepDir = dir < 0 ? -1 : 1;
    const nextIdx = ((curIdx < 0 ? 0 : curIdx) + stepDir + AUDIO_MODES.length) % AUDIO_MODES.length;
    const nextSpec = AUDIO_MODES[nextIdx];
    userMode = nextSpec.mode;
    userVolume = nextSpec.volume;
    userMuted = nextSpec.muted;
    saveAudioPrefs();
    applyMasterGain(lastFrozen);
    return getAudioPrefs();
  }

  function buildBeds() {
    noise = {
      white: makeNoise('white', 4.2),
      pink: makeNoise('pink', 4.2),
      brown: makeNoise('brown', 4.2)
    };

    beds = {};
    beds.windLow = makeBed(noise.brown, { lp: 240, q: 0.7 });
    beds.windMid = makeBed(noise.pink, { bp: 620, q: 0.55 });
    beds.leaves = makeBed(noise.pink, { hp: 2100, lp: 8800, q: 0.55 });
    beds.river = makeBed(noise.pink, { hp: 170, lp: 1450, q: 0.7 });
    beds.riverHigh = makeBed(noise.white, { bp: 2350, q: 0.85 });
    beds.pond = makeBed(noise.pink, { lp: 720, q: 0.7 });
    beds.cave = makeBed(noise.brown, { lp: 170, q: 0.8 });
    beds.village = makeBed(noise.pink, { lp: 500, q: 0.7 });
    beds.villageHigh = makeBed(noise.pink, { hp: 350, lp: 1800, q: 0.5 });
    // 雨：粉噪做主体（柔和不刺耳），少量白噪做雨点的高频闪光
    beds.rain = makeBed(noise.pink, { hp: 500, lp: 6000, q: 0.6 });
    beds.rainLow = makeBed(noise.pink, { lp: 400, q: 0.7 });
    beds.rainHigh = makeBed(noise.white, { hp: 2800, lp: 8500, q: 0.7 });
    beds.night = makeBed(noise.brown, { lp: 190, q: 0.8 });
    // 北涧三叠飞泉与东皋苍松岭空间底景（远距自动归零，近处随方位立体声平移）
    beds.cascade = makeBed(noise.pink, { hp: 180, lp: 1750, q: 0.68 });
    beds.cascadeHigh = makeBed(noise.white, { bp: 2950, q: 0.9 });
    beds.pineWind = makeBed(noise.pink, { bp: 510, q: 0.95 });

    // 洞里的底噪也要进石壁混响，否则听不出「在洞里」
    const caveBedSend = ctx.createGain();
    caveBedSend.gain.value = 0.75;
    beds.cave.node.connect(caveBedSend);
    caveBedSend.connect(caveSend);
  }

  function unlock() {
    try {
      if (!ctx) {
        if (!buildGraph()) return false;
        started = true;
        buildBeds();
        ready = true;
        applyBeds(true);
      } else if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        const res = ctx.resume?.();
        if (res?.catch) res.catch(() => {});
      }
      // The sample engine resumes synchronously in this gesture, then decodes once asynchronously.
      void samples.unlock();
      return ready;
    } catch (_) {
      // A partial graph must not permanently disable later genuine gestures.
      samples.dispose();
      samples = createSampleAudio({ catalogue: deps.audioCatalogue || catalogue, config: SC.samples, baseUrl, fetch: deps.audioFetch || globalThis.fetch });
      if (userMuted || userVolume <= 0.001) samples.setMuted(true);
      const failed = ctx;
      ready = false; started = false; ctx = null;
      master = null; sampleBus = null; sampleCaveSend = null; analyser = null; revSend = null; caveSend = null;
      noise = null; beds = null; hasListener = false; resetBedState();
      if (failed) {
        try {
          const closing = failed.close();
          if (closing?.catch) closing.catch(() => {});
        } catch (_) { /* Partially constructed contexts may not be closable. */ }
      }
      return false;
    }
  }

  // ---- 距离、方向与声场 ----
  function nearestSpine(x, z) {
    const pts = deps.riverSpine;
    if (!pts || !pts.length) return null;
    let best = Infinity, bx = x, bz = z;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] - x;
      const dz = pts[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bx = pts[i][0]; bz = pts[i][1]; }
    }
    return { x: bx, z: bz, d: Math.sqrt(best) };
  }

  function panFor(x, z) {
    const dx = x - listener.x;
    const dz = z - listener.z;
    const d = Math.hypot(dx, dz) + 5;
    const rx = Math.cos(listener.yaw);
    const rz = -Math.sin(listener.yaw);
    return clamp((dx * rx + dz * rz) / d, -1, 1) * 0.82;
  }

  function spatialOut(x, z, base, opts) {
    opts = opts || {};
    const dx = x - listener.x;
    const dz = z - listener.z;
    const d = Math.hypot(dx, dz);
    const g = ctx.createGain();
    const gain = (base || 0.3) * (1 / (1 + d / (opts.falloff || 15)));
    g.gain.value = gain;

    const p = pannerNode();
    let tail = g;
    const owned = [g];
    if (p) {
      p.pan.value = opts.flat ? 0 : panFor(x, z);
      g.connect(p);
      tail = p;
      owned.push(p);
    }
    if (!opts.flat) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      // 远距空气吸收：「阡陌交通，鸡犬相闻」在 >45m 处渐敛高频刺感，更显山谷辽阔深远
      const farAirDrop = d > 42 ? (1 + (d - 42) * 0.022) : 1;
      lp.frequency.value = clamp(15000 / ((1 + d / 22) * farAirDrop), 660, 15000);
      lp.Q.value = 0.4;
      tail.connect(lp);
      tail = lp;
      owned.push(lp);
    }
    tail.connect(master);
    if (!opts.dry) {
      if (d > 48) {
        const valleyWet = ctx.createGain();
        valleyWet.gain.value = 1 + 0.68 * smoothstep(48, 120, d) * (1 + 0.25 * syncState.quietBlend);
        tail.connect(valleyWet);
        valleyWet.connect(revSend);
        owned.push(valleyWet);
      } else {
        tail.connect(revSend);
      }
    }
    if (region.cave > 0.08) tail.connect(caveSend);
    autoDisconnect(owned, Number.isFinite(opts.life) ? opts.life : (opts.dry ? 1.5 : 3.6));
    return g;
  }

  // ---- 基础发声积木 ----
  function tone(dest, type, f0, f1, t, dur, gain, opts) {
    opts = opts || {};
    const d = Math.max(0.025, Number.isFinite(dur) ? dur : 0.12);
    const t0 = Math.max(now(), Number.isFinite(t) ? t : now());
    const tEnd = t0 + d;
    const peak = Math.max(0.0002, Number.isFinite(gain) ? gain : 0.05);
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (Number.isFinite(opts.fMid)) {
      const tMid = clamp(t0 + d * (opts.fMidAt ?? 0.18), t0 + 0.003, tEnd - 0.003);
      if (tMid > t0 && tMid < tEnd) {
        o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.fMid), tMid);
      }
    }
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), tEnd);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    const env = opts.env || 'decay';
    if (env === 'swell' || env === 'breath') {
      const atk = clamp(opts.attack ?? Math.min(0.09, d * 0.25), 0.003, d * 0.42);
      const t1 = t0 + atk;
      const t2 = clamp(t0 + d * 0.65, t1 + 0.003, tEnd - 0.003);
      const sus = Math.max(0.00015, peak * (opts.sustain ?? 0.75));
      g.gain.linearRampToValueAtTime(peak, t1);
      if (t2 > t1 && t2 < tEnd) g.gain.exponentialRampToValueAtTime(sus, t2);
      g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    } else {
      const atk = clamp(opts.attack ?? 0.008, 0.002, d * 0.28);
      const t1 = t0 + atk;
      const t2 = clamp(t0 + Math.max(atk + 0.006, d * 0.22), t1 + 0.003, tEnd - 0.003);
      const body = Math.max(0.00015, peak * (opts.body ?? 0.35));
      g.gain.linearRampToValueAtTime(peak, t1);
      if (t2 > t1 && t2 < tEnd) g.gain.exponentialRampToValueAtTime(body, t2);
      g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    }

    const owned = [o, g];
    let node = o;
    if (opts.hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = opts.hp;
      f.Q.value = opts.q || 0.7;
      node.connect(f); node = f; owned.push(f);
    }
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      f.Q.value = opts.q || 0.7;
      node.connect(f); node = f; owned.push(f);
    }
    if (opts.bp) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = opts.bp;
      f.Q.value = opts.q || 1.0;
      node.connect(f); node = f; owned.push(f);
    }
    node.connect(g); g.connect(dest);
    o.start(t0); o.stop(tEnd + 0.03);
    autoDisconnect(owned, Math.max(0.15, tEnd + 0.11 - now()), o);
  }

  function noiseBurst(dest, t, dur, gain, type, freq, q, opts) {
    opts = opts || {};
    const d = Math.max(0.016, Number.isFinite(dur) ? dur : 0.05);
    const t0 = Math.max(now(), Number.isFinite(t) ? t : now());
    const tEnd = t0 + d;
    const atk = clamp(opts.attack ?? Math.min(0.008, d * 0.32), 0.002, d * 0.45);
    const t1 = t0 + atk;
    const peak = Math.max(0.0002, Number.isFinite(gain) ? gain : 0.04);

    const src = ctx.createBufferSource();
    src.buffer = (opts.pink && noise.pink) ? noise.pink : noise.white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    if (Number.isFinite(opts.freqEnd)) {
      f.frequency.setValueAtTime(Math.max(40, freq || 1200), t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), tEnd);
    } else {
      f.frequency.value = freq || 1200;
    }
    f.Q.value = q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t1);
    g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 2.8);
    src.stop(tEnd + 0.02);
    autoDisconnect([src, f, g], Math.max(0.15, tEnd + 0.11 - now()), src);
  }

  const ROLE_VOICE_PROFILE = {
    elder: { gain: 0.94, falloff: 14.5 },
    shrine_elder: { gain: 0.92, falloff: 14.5 },
    feast_elder: { gain: 0.96, falloff: 14.5 },
    child: { gain: 0.88, falloff: 11.5 },
    child_grass: { gain: 0.88, falloff: 11.5 },
    child_stones: { gain: 0.88, falloff: 11.5 },
    child_top: { gain: 0.90, falloff: 11.5 },
    woman: { gain: 0.93, falloff: 12.5 },
    weaver: { gain: 0.91, falloff: 12.0 },
    washer: { gain: 0.92, falloff: 12.5 },
    feast_guest: { gain: 0.94, falloff: 13.0 },
    feast_host: { gain: 1.02, falloff: 14.0 },
    fou_singer: { gain: 1.00, falloff: 15.0 }
  };

  // Nonverbal recorded acknowledgement on explicit interaction; occasional laughter only in social chatter.
  function voice(role, x, z, opts = {}) {
    if (!ready) return false;
    const ambient = !!(opts.chatter || opts.ambient);
    const px = x === undefined ? listener.x : x, pz = z === undefined ? listener.z : z;
    let emitterId = opts.emitterId;
    if (emitterId === undefined && deps.people?.list) {
      const index = deps.people.list.findIndex(p => p.role === role && Math.hypot(p.x - px, p.z - pz) < 2);
      if (index >= 0) emitterId = 'person:' + index;
    }
    const prof = ROLE_VOICE_PROFILE[role] || null;
    const roleGain = prof ? prof.gain : 1.0;
    const baseFalloff = ambient ? 18 : (prof ? prof.falloff : 13);
    const played = samples.play(ambient && opts.laugh ? 'voice-laugh' : 'voice-ack', {
      x: px, z: pz, emitterId, ambient,
      gain: (SC.voice?.gain ?? 0.6) * (opts.gain ?? 1) * roleGain,
      falloff: opts.falloff ?? baseFalloff
    });
    if (played) stats.voices++;
    return played;
  }

  function animalSample(category, x, z, opts = {}) {
    if (!ready) return false;
    const played = samples.play(category, { ...opts, x: x ?? listener.x, z: z ?? listener.z, gain: (SC.animals?.[category] ?? 0.55) * (opts.gain ?? 1) });
    return played;
  }
  function cluck(x, z) {
    const played = animalSample('cluck', x, z);
    if (played) stats.clucks++;
    return played;
  }
  function bark(x, z) {
    const played = animalSample('bark', x, z);
    if (played) stats.barks++;
    return played;
  }
  function chirp(x, z) {
    const played = animalSample('chirp', x, z);
    if (played) stats.chirps++;
    return played;
  }
  function low(x, z) {
    const played = animalSample('low', x, z);
    if (played) stats.lows++;
    return played;
  }
  function quack(x, z) {
    const played = animalSample('quack', x, z);
    if (played) stats.quacks++;
    return played;
  }

  function wood(x, z) {
    if (!canRunProcedural()) return;
    const px = x === undefined ? listener.x : x;
    const pz = z === undefined ? listener.z : z;
    if (hasListener && x !== undefined && z !== undefined && Math.hypot(px - listener.x, pz - listener.z) > 90) return;
    const out = spatialOut(px, pz, 0.40, { falloff: 8, life: 0.45 });
    const t = now() + 0.01;
    noiseBurst(out, t, 0.065, 0.11, 'bandpass', 1050, 1.9, { pink: true, attack: 0.003 });
    tone(out, 'sine', 185, 95, t, 0.13, 0.115, { lp: 900, attack: 0.004, body: 0.32 });
    tone(out, 'triangle', 420, 300, t, 0.06, 0.038, { lp: 1800, attack: 0.003, body: 0.25 });
  }

  // 犁铧破土与翻泥落垄的绵密沙沙声（铧尖破湿壤低频闷涌 + 泥浪翻滚中频沙沙 + 细土簌簌 + 偶发曲木犁轭微响）。
  function plowScrape(x, z, opts = {}) {
    if (!canPlayProcedural()) return false;
    const px = Number.isFinite(x) ? x : listener.x;
    const pz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(px - listener.x, pz - listener.z) > 68) return false;
    try {
      const baseInt = Number.isFinite(opts?.intensity) ? clamp(opts.intensity, 0.45, 1.35) : 1.0;
      const boost = baseInt * (1 + 0.18 * syncState.quietBlend);
      const out = spatialOut(px, pz, 0.36 * boost, { falloff: 14, life: 0.72 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.46, 0.095, 'bandpass', 330 + rand(-28, 34), 1.05, { pink: true, attack: 0.055, freqEnd: 245 });
      noiseBurst(out, t + 0.02, 0.44, 0.115, 'bandpass', 1020 + rand(-90, 115), 0.92, { pink: true, attack: 0.05, freqEnd: 1340 });
      noiseBurst(out, t + 0.085, 0.34, 0.052, 'bandpass', 2260 + rand(-150, 170), 1.15, { pink: true, attack: 0.04, freqEnd: 1760 });
      tone(out, 'sine', 96 + rand(-7, 9), 58, t, 0.24, 0.048, { lp: 280, attack: 0.025, body: 0.34 });
      if (opts?.creak) {
        tone(out, 'triangle', 246 + rand(-14, 16), 210, t + 0.05, 0.16, 0.026, { bp: 520, q: 2.2, lp: 960, attack: 0.028, body: 0.30 });
      }
      stats.rustles++;
      worldSync.plowScrapes++;
      return true;
    } catch (_) { return false; }
  }


  // 耕牛浑厚低鸣（优先播放本地开源实录牛哞采样，采样繁忙或未就绪时无缝回退至水牛胸腔共鸣低哞合成）。
  function oxLow(x, z) {
    if (!canPlayProcedural()) return false;
    const ox = Number.isFinite(x) ? x : listener.x;
    const oz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(ox - listener.x, oz - listener.z) > 82) return false;
    try {
      const quietBoost = 1 + 0.16 * syncState.quietBlend;
      const playedSample = samples.play('low', {
        x: ox,
        z: oz,
        emitterId: 'plow-ox',
        gain: (SC.animals?.low ?? 0.6) * 1.18 * quietBoost,
        falloff: 24
      });
      if (playedSample) {
        stats.lows++;
        worldSync.oxLows++;
        return true;
      }
      const recordedBuf = samples.pickBuffer ? samples.pickBuffer('low') : null;
      if (recordedBuf) {
        playSpatialBuffer(recordedBuf, ox, oz, {
          gain: 0.42 * quietBoost,
          rate: 0.97,
          falloff: 24,
          hp: 62,
          lp: 2400,
          attack: 0.032,
          release: 0.14
        });
        stats.lows++;
        worldSync.oxLows++;
        return true;
      }
      const out = spatialOut(ox, oz, 0.30 * quietBoost, { falloff: 22, life: 1.85 });
      const t = now() + 0.012;
      const f0 = 88 + rand(-5, 6);
      noiseBurst(out, t, 0.26, 0.028, 'bandpass', 360, 1.6, { pink: true, attack: 0.05, freqEnd: 240 });
      tone(out, 'triangle', f0, f0 * 0.82, t + 0.02, 1.24, 0.115, {
        env: 'breath', attack: 0.18, sustain: 0.72, fMid: f0 * 1.15, fMidAt: 0.28, lp: 420
      });
      tone(out, 'sine', f0 * 2.0, f0 * 1.64, t + 0.03, 1.16, 0.068, {
        env: 'breath', attack: 0.18, sustain: 0.68, fMid: f0 * 2.28, fMidAt: 0.28, bp: 235, q: 1.9, lp: 620
      });
      tone(out, 'triangle', f0 * 3.0, f0 * 2.48, t + 0.04, 0.98, 0.034, {
        env: 'breath', attack: 0.20, sustain: 0.62, bp: 410, q: 2.3, lp: 880
      });
      stats.lows++;
      worldSync.oxLows++;
      return true;
    } catch (_) { return false; }
  }


  // Shimmering ancient bronze wind-bell (风铎) with beat partial & minor-third/fifth overtones through revSend.
  function bell(x, z) {
    if (!canRunProcedural()) return false;
    try {
      const bx = Number.isFinite(x) ? x : listener.x;
      const bz = Number.isFinite(z) ? z : listener.z;
      const out = spatialOut(bx, bz, 0.24, { falloff: 12, life: 3.1 });
      const t = now() + 0.012;
      const f0 = 293.66;
      const partials = [
        [1.0, 0.145, 2.75, 0.36],
        [1.003, 0.088, 2.55, 0.34],
        [1.202, 0.052, 1.85, 0.28],
        [1.504, 0.034, 1.45, 0.25],
        [2.72, 0.019, 0.85, 0.20]
      ];
      for (let i = 0; i < partials.length; i++) {
        const [ratio, gain, duration, body] = partials[i];
        tone(out, 'sine', f0 * ratio, f0 * ratio * 0.9985, t, duration, gain, {
          env: 'decay', attack: 0.005, body: body
        });
      }
      noiseBurst(out, t, 0.022, 0.026, 'bandpass', 1850, 2.6, { pink: true, attack: 0.003 });
      return true;
    } catch (_) { return false; }
  }


  // ---- 环境事件：水滴、鸟、虫、蛙、远处狗叫、村里锅碗 ----
  function drip(x, z, level) {
    const out = spatialOut(x, z, 0.22 * level, { falloff: 9, life: 0.55 });
    const t = now() + 0.01;
    tone(out, 'sine', 920 + rand(-80, 110), 1380 + rand(-70, 90), t, 0.068, 0.13, { lp: 4600, attack: 0.003, body: 0.36 });
    tone(out, 'sine', 520, 660, t + 0.018, 0.12, 0.048, { lp: 2200, attack: 0.004, body: 0.30 });
    stats.drips++;
  }

  function bird(x, z, presence) {
    const boost = 1 + 0.22 * syncState.quietBlend;
    const played = animalSample('chirp', x, z, { gain: presence * 0.35 * boost, ambient: true, emitterId: 'ambient-bird' });
    if (played) stats.chirps++;
    return played;
  }

  function cricket(x, z, gainScale = 1) {
    const out = spatialOut(x, z, 0.095 * gainScale * ((SC.animals && SC.animals.cricket) || 0.08) / 0.08, { falloff: 16, dry: true, life: 0.36 });
    const t0 = now() + 0.01;
    const f = 4220 + rand(0, 460);
    const pulses = 4 + ((Math.random() * 2) | 0);
    const stepP = 0.028;
    const tEnd = t0 + pulses * stepP + 0.008;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.996, t0);
    o.frequency.exponentialRampToValueAtTime(f * 1.008, tEnd);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 4.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    for (let i = 0; i < pulses; i++) {
      const ps = t0 + i * stepP;
      const win = Math.sin(((i + 0.65) / (pulses + 0.3)) * Math.PI);
      const pk = Math.max(0.0005, 0.024 + 0.048 * win);
      if (i > 0) g.gain.setValueAtTime(0.0002, ps);
      g.gain.linearRampToValueAtTime(pk, ps + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0002, ps + 0.023);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    o.connect(bp);
    bp.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(tEnd + 0.02);
    autoDisconnect([o, bp, g], Math.max(0.18, tEnd + 0.1 - now()), o);
    stats.chirps++;
  }

  function frog(x, z) {
    if (!canPlayProcedural()) return false;
    const fx = Number.isFinite(x) ? x : (pond ? pond.x : listener.x);
    const fz = Number.isFinite(z) ? z : (pond ? pond.z : listener.z);
    try {
      const recordedBuf = samples.pickBuffer ? samples.pickBuffer('frog') : null;
      if (recordedBuf) {
        const baseGain = (SC.animals?.frog ?? 0.28) * (1 + 0.16 * syncState.quietBlend);
        playSpatialBuffer(recordedBuf, fx, fz, {
          gain: baseGain,
          rate: 1.0,
          falloff: 20,
          hp: 165,
          lp: 4800,
          attack: 0.012,
          release: 0.055
        });
        stats.frogs++;
        return true;
      }
      const out = spatialOut(fx, fz, 0.16, { falloff: 16, life: 0.85 });
      const t0 = now() + 0.01;
      const baseF = 182 + rand(0, 46);
      const croaks = 1 + ((Math.random() * 2) | 0);
      const bp1 = ctx.createBiquadFilter();
      bp1.type = 'bandpass';
      bp1.frequency.value = 620 + rand(-30, 30);
      bp1.Q.value = 2.8;
      const bp2 = ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = 1150 + rand(-45, 45);
      bp2.Q.value = 3.2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.52;
      bp1.connect(out);
      bp2.connect(g2);
      g2.connect(out);

      let lastEnd = t0 + 0.25;
      for (let c = 0; c < croaks; c++) {
        const pulses = 3 + ((Math.random() * 2) | 0);
        const croakStart = t0 + c * 0.22;
        const stepP = 0.032;
        const croakEnd = croakStart + pulses * stepP + 0.008;
        if (croakEnd > lastEnd) lastEnd = croakEnd;

        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(baseF * (0.95 + 0.03 * c), croakStart);
        o.frequency.exponentialRampToValueAtTime(baseF * (1.12 + 0.03 * c), croakEnd);

        const eg = ctx.createGain();
        eg.gain.setValueAtTime(0.0001, croakStart);
        for (let p = 0; p < pulses; p++) {
          const ps = croakStart + p * stepP;
          const arch = Math.sin(((p + 0.6) / (pulses + 0.2)) * Math.PI);
          const pk = Math.max(0.001, 0.115 + 0.068 * arch);
          if (p > 0) eg.gain.setValueAtTime(0.0003, ps);
          eg.gain.linearRampToValueAtTime(pk, ps + 0.006);
          eg.gain.exponentialRampToValueAtTime(0.0003, ps + 0.028);
        }
        eg.gain.exponentialRampToValueAtTime(0.0001, croakEnd);

        o.connect(eg);
        eg.connect(bp1);
        eg.connect(bp2);
        o.start(croakStart);
        o.stop(croakEnd + 0.02);
        autoDisconnect([o, eg], Math.max(0.2, croakEnd + 0.1 - now()), o);
      }
      noiseBurst(out, t0 + 0.008, 0.09, 0.018, 'bandpass', 880, 2.4, { pink: true, attack: 0.012 });
      autoDisconnect([bp1, bp2, g2], Math.max(0.28, lastEnd + 0.14 - now()));
      stats.frogs++;
      return true;
    } catch (_) { return false; }
  }


  function laundryPound(x, z, strokes = 2) {
    if (!canPlayProcedural()) return false;
    try {
      const count = Math.max(1, Math.min(3, strokes | 0));
      const out = spatialOut(x, z, 0.19, { falloff: 14, life: 1.2 });
      const t = now() + 0.01;
      for (let i = 0; i < count; i++) {
        const pt = t + i * 0.24;
        tone(out, 'triangle', 175 + rand(-12, 14), 106, pt, 0.095, 0.145, { lp: 900, attack: 0.004, body: 0.30 });
        noiseBurst(out, pt, 0.045, 0.058, 'bandpass', 620 + rand(-70, 70), 2.1, { pink: true, attack: 0.003 });
      }
      worldSync.laundryPounds++;
      return true;
    } catch (_) { return false; }
  }


  function wheelCreak(x, z, intensity = 0.7) {
    if (!canPlayProcedural()) return false;
    try {
      const lvl = clamp(intensity, 0.2, 1.2);
      const out = spatialOut(x, z, 0.16 * lvl, { falloff: 16, life: 1.05 });
      const t = now() + 0.01;
      const f0 = 118 + rand(-10, 14);
      // Warm low wet-timber groan + wooden grain stick-slip impulses + gentle bucket splash
      tone(out, 'triangle', f0, f0 * 0.91, t, 0.34, 0.052, {
        env: 'breath', attack: 0.06, sustain: 0.68, bp: 340, q: 2.8
      });
      for (let k = 0; k < 3; k++) {
        const kt = t + 0.02 + k * (0.058 + rand(-0.008, 0.012));
        tone(out, 'triangle', 460 + k * 38 + rand(-25, 25), 340 + k * 20, kt, 0.032, 0.034 * (1 - k * 0.15), {
          bp: 680 + k * 90, q: 3.6, attack: 0.004, body: 0.30
        });
      }
      noiseBurst(out, t + 0.05, 0.24, 0.042, 'bandpass', 920, 1.3, { pink: true, attack: 0.03, freqEnd: 1380 });
      tone(out, 'sine', 360 + rand(-30, 40), 540 + rand(-20, 40), t + 0.11, 0.065, 0.024, { lp: 1400, attack: 0.005 });
      worldSync.wheelCreaks++;
      return true;
    } catch (_) { return false; }
  }


  function gateCreak(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const out = spatialOut(x, z, 0.17, { falloff: 13, life: 0.85 });
      const t = now() + 0.01;
      const f0 = 168 + rand(-14, 18);
      // Brushwood hinge wooden socket rub + stick-slip grain ticks + twig rustle
      tone(out, 'triangle', f0, f0 * 1.16, t + 0.015, 0.24, 0.048, {
        env: 'breath', attack: 0.045, sustain: 0.65, bp: 540, q: 3.2
      });
      for (let k = 0; k < 4; k++) {
        const kt = t + k * (0.044 + rand(-0.005, 0.008));
        tone(out, 'sine', 580 + k * 45 + rand(-30, 30), 420 + k * 25, kt, 0.026, 0.035 * (0.85 + 0.15 * (k % 2)), {
          bp: 860 + k * 70, q: 3.8, attack: 0.003, body: 0.28
        });
      }
      noiseBurst(out, t + 0.01, 0.16, 0.032, 'bandpass', 1450, 1.8, { pink: true, attack: 0.015 });
      worldSync.gateCreaks++;
      return true;
    } catch (_) { return false; }
  }


  let roosterBuf = null;
  let roosterBufSr = 0;
  const activeCrowStops = new Set();

  function stopActiveCrows() {
    for (const stopFn of activeCrowStops) {
      try { stopFn(); } catch (_) {}
    }
    activeCrowStops.clear();
  }

  function playSpatialBuffer(buf, x, z, opts = {}) {
    const sr = ctx.sampleRate || 44100;
    const t = now() + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = Number.isFinite(opts.rate) ? opts.rate : 1.0;
    if (src.playbackRate) src.playbackRate.value = rate;
    const playDur = Math.max(0.05, buf.duration / rate);
    const out = spatialOut(x, z, opts.gain ?? 0.25, {
      falloff: opts.falloff ?? 24,
      dry: Boolean(opts.dry),
      life: playDur + 0.38
    });

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.min(opts.hp ?? 140, sr * 0.25);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(opts.lp ?? 7200, sr * 0.44);

    const env = ctx.createGain();
    const atk = Math.min(opts.attack ?? 0.016, playDur * 0.25);
    const rel = Math.min(opts.release ?? 0.065, playDur * 0.35);
    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(1.0, t + atk);
    env.gain.setValueAtTime(1.0, Math.max(t + atk + 0.01, t + playDur - rel));
    env.gain.linearRampToValueAtTime(0.001, t + playDur);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(env);
    env.connect(out);
    const owned = [src, hp, lp, env];
    const stopNow = function () {
      activeCrowStops.delete(stopNow);
      try { src.stop(); } catch (_) {}
      disconnectNodes(owned);
    };
    activeCrowStops.add(stopNow);
    src.start(t);
    src.stop(t + playDur + 0.02);
    autoDisconnect(owned, playDur + 0.25, src);
    const prevEnded = src.onended;
    src.onended = function () {
      activeCrowStops.delete(stopNow);
      if (prevEnded) prevEnded();
    };
    return { out, t, playDur };
  }

  function roosterFlap(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const rx = Number.isFinite(x) ? x : listener.x;
      const rz = Number.isFinite(z) ? z : listener.z;
      const out = spatialOut(rx, rz, 0.24, { falloff: 15, dry: true, life: 0.42 });
      const t = now() + 0.008;
      // Two crisp pre-crow wing-beats (~0.082s apart): airy downstroke breeze + stiff feather quill brush + soft chest puff
      for (let b = 0; b < 2; b++) {
        const bt = t + b * 0.082;
        const w = b === 0 ? 1.0 : 0.86;
        noiseBurst(out, bt, 0.068, 0.076 * w, 'bandpass', 620 + b * 70, 1.35, {
          pink: true, attack: 0.010, freqEnd: 1180 + b * 90
        });
        noiseBurst(out, bt + 0.008, 0.042, 0.040 * w, 'bandpass', 2160 + b * 140, 1.9, {
          pink: true, attack: 0.004, freqEnd: 1640 + b * 80
        });
        tone(out, 'sine', (144 + b * 10) + rand(-6, 6), 86 + b * 6, bt + 0.005, 0.056, 0.054 * w, {
          lp: 330, attack: 0.004, body: 0.30
        });
      }
      worldSync.roosterFlaps++;
      return true;
    } catch (_) { return false; }
  }


  function makeRoosterResonator(fc, q, sr) {
    if (!(fc > 20 && fc < sr * 0.44)) return null;
    const f = { b0: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
    tuneRoosterResonator(f, fc, q, sr);
    return f;
  }

  function tuneRoosterResonator(f, fc, q, sr) {
    if (!f || !(fc > 20 && fc < sr * 0.44)) return;
    const w0 = (2 * Math.PI * fc) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const norm = 1 / (1 + alpha);
    f.b0 = alpha * norm;
    f.b2 = -alpha * norm;
    f.a1 = -2 * Math.cos(w0) * norm;
    f.a2 = (1 - alpha) * norm;
  }

  function stepRoosterResonator(f, x) {
    if (!f) return 0;
    const y = f.b0 * x + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x;
    f.y2 = f.y1; f.y1 = y;
    return y;
  }

  // Bioacoustic avian syrinx fallback (used only before recorded CC0 rooster clips finish decoding or in offline tests)
  function getRoosterBuffer() {
    const sr = Math.max(800, Math.round(ctx.sampleRate || 44100));
    if (roosterBuf && roosterBufSr === sr) return roosterBuf;
    const dur = 1.58;
    const n = Math.max(256, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, n, sr);
    const ch = buf.getChannelData(0);

    // 4 段禽类鸣管啼鸣：短促起腔 — 扬颈 — 亮嗓 — 长拖尾泄气落调
    const syllables = [
      { t0: 0.025, t1: 0.145, f0: 470, fPeak: 595, f1: 560, amp: 0.56, open: 0.45, rasp: 0.34, breath: 0.22 },
      { t0: 0.185, t1: 0.315, f0: 545, fPeak: 735, f1: 705, amp: 0.80, open: 0.70, rasp: 0.24, breath: 0.16 },
      { t0: 0.355, t1: 0.495, f0: 700, fPeak: 825, f1: 775, amp: 0.93, open: 0.92, rasp: 0.18, breath: 0.13 },
      { t0: 0.540, t1: 1.500, f0: 685, fPeak: 835, f1: 435, amp: 1.00, open: 1.00, rasp: 0.16, breath: 0.18, longTail: true }
    ];

    const fChest = makeRoosterResonator(Math.min(440, sr * 0.34), 2.4, sr);
    const f1Res = makeRoosterResonator(860, 4.2, sr);
    const f2Res = makeRoosterResonator(1780, 5.0, sr);
    const f3Res = makeRoosterResonator(3080, 5.8, sr);

    let ph = 0;
    let subPh = 0;
    let pink = 0;
    let jitter = 0;
    let lcg = 0x51a79d;
    let maxAbs = 1e-6;

    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = 0;
      let freq = 520;
      let openAmt = 0.5;
      let raspMix = 0.2;
      let breathMix = 0.15;

      for (let s = 0; s < syllables.length; s++) {
        const sy = syllables[s];
        if (t >= sy.t0 && t <= sy.t1) {
          const u = (t - sy.t0) / Math.max(0.01, sy.t1 - sy.t0);
          const atkSpan = sy.longTail ? 0.08 : 0.15;
          const relSpan = sy.longTail ? 0.30 : 0.22;
          const atk = Math.min(1, u / atkSpan);
          const rel = Math.min(1, (1 - u) / relSpan);
          const envAtk = atk * atk * (3 - 2 * atk);
          const envRel = sy.longTail ? Math.pow(rel, 1.45) : (rel * rel * (3 - 2 * rel));
          const lungUndul = sy.longTail
            ? (1 - 0.08 * u + 0.045 * Math.sin(2 * Math.PI * 6.8 * t))
            : 1;
          env = sy.amp * envAtk * envRel * lungUndul;

          if (sy.longTail) {
            if (u < 0.13) {
              const k = u / 0.13;
              freq = sy.f0 + (sy.fPeak - sy.f0) * (1 - (1 - k) * (1 - k));
            } else if (u < 0.62) {
              const k = (u - 0.13) / 0.49;
              freq = sy.fPeak - 38 * k + 7 * Math.sin(2 * Math.PI * 5.6 * t);
            } else {
              const k = (u - 0.62) / 0.38;
              freq = (sy.fPeak - 38) + (sy.f1 - (sy.fPeak - 38)) * Math.pow(k, 1.65);
            }
            openAmt = sy.open * (u < 0.65 ? 1 : (1 - 0.55 * ((u - 0.65) / 0.35)));
            const edgeStrain = (u < 0.12 ? (1 - u / 0.12) * 0.28 : 0) + (u > 0.66 ? ((u - 0.66) / 0.34) * 0.42 : 0);
            raspMix = sy.rasp + edgeStrain;
            breathMix = sy.breath + (u > 0.68 ? 0.22 * ((u - 0.68) / 0.32) : 0);
          } else {
            if (u < 0.58) {
              const k = u / 0.58;
              freq = sy.f0 + (sy.fPeak - sy.f0) * Math.sin(k * Math.PI * 0.5);
            } else {
              const k = (u - 0.58) / 0.42;
              freq = sy.fPeak + (sy.f1 - sy.fPeak) * (k * k);
            }
            openAmt = sy.open * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85);
            raspMix = sy.rasp * (u < 0.28 ? 1.35 : 0.75);
            breathMix = sy.breath;
          }
          break;
        }
      }

      if (env <= 1e-5) {
        ch[i] = 0;
        continue;
      }

      if ((i & 63) === 0 && f1Res) {
        tuneRoosterResonator(f1Res, 700 + 390 * openAmt, 4.0, sr);
        tuneRoosterResonator(f2Res, 1540 + 640 * openAmt, 4.8, sr);
        tuneRoosterResonator(f3Res, 2880 + 440 * openAmt, 5.6, sr);
      }

      lcg = (lcg * 1664525 + 1013904223) >>> 0;
      const white = (lcg / 0xffffffff) * 2 - 1;
      pink = pink * 0.74 + white * 0.26;
      jitter = jitter * 0.965 + white * 0.035;

      const fInst = freq * (1 + 0.011 * jitter + 0.005 * pink);
      ph += fInst / sr;
      ph -= Math.floor(ph);
      subPh += (0.5 * fInst) / sr;
      subPh -= Math.floor(subPh);

      const oq = 0.27;
      let pulse = 0;
      if (ph < oq) {
        const uq = ph / oq;
        pulse = Math.sin(uq * Math.PI) * (1 + 0.35 * Math.sin(2 * uq * Math.PI));
      } else {
        const uc = (ph - oq) / (1 - oq);
        pulse = -0.34 * Math.exp(-uc * 5.2) * Math.cos(uc * Math.PI * 0.5);
      }

      const subHarm = Math.sin(2 * Math.PI * subPh) + 0.55 * Math.sin(2 * Math.PI * 3 * subPh + 0.4);
      const ringHarm = 0.32 * Math.sin(2 * Math.PI * 3 * ph) + 0.22 * Math.sin(2 * Math.PI * 4 * ph + 0.2) + 0.14 * Math.sin(2 * Math.PI * 5 * ph);
      const glotOpen = ph < 0.36 ? Math.sin((ph / 0.36) * Math.PI) : 0.12;
      const excite = (pulse * 0.95 + ringHarm + raspMix * subHarm * 0.42 + breathMix * glotOpen * (pink * 1.1 + white * 0.45)) * env;

      const rLow = stepRoosterResonator(fChest, excite);
      const r1 = stepRoosterResonator(f1Res, excite);
      const r2 = stepRoosterResonator(f2Res, excite);
      const r3 = stepRoosterResonator(f3Res, excite);
      const vocal = f1Res
        ? (excite * 0.10 + rLow * 0.26 + r1 * 1.12 + r2 * 1.28 + r3 * 0.92)
        : (excite * 0.52 + rLow * 0.65);

      ch[i] = vocal;
      const a = Math.abs(vocal);
      if (a > maxAbs) maxAbs = a;
    }

    const norm = 0.86 / maxAbs;
    const edgeFade = Math.max(4, Math.floor(sr * 0.008));
    for (let i = 0; i < n; i++) {
      let s = Math.tanh(ch[i] * norm * 1.14);
      if (i < edgeFade) s *= i / edgeFade;
      else if (i > n - edgeFade) s *= (n - i) / edgeFade;
      ch[i] = Number.isFinite(s) ? clamp(s, -0.98, 0.98) : 0;
    }

    roosterBuf = buf;
    roosterBufSr = sr;
    return buf;
  }

  function roosterCrow(x, z, opts = {}) {
    if (!canPlayProcedural()) return false;
    try {
      const isEcho = !!opts.echo;
      const rx = Number.isFinite(x) ? x : listener.x;
      const rz = Number.isFinite(z) ? z : listener.z;
      const recordedBuf = samples.pickBuffer ? samples.pickBuffer('crow') : null;
      const isRecorded = Boolean(recordedBuf);
      const buf = recordedBuf || getRoosterBuffer();
      const baseGain = SC.animals?.crow ?? 0.58;
      const gainScale = isRecorded
        ? (isEcho ? baseGain * 0.42 : baseGain * 0.86)
        : (isEcho ? 0.16 : 0.30);
      const rate = isRecorded
        ? (Number.isFinite(opts.pitch) ? clamp(opts.pitch, 0.92, 1.08) : 1.0)
        : (isEcho ? 1.07 : clamp(Number.isFinite(opts.pitch) ? opts.pitch : rand(0.96, 1.04), 0.86, 1.18));
      playSpatialBuffer(buf, rx, rz, {
        gain: gainScale,
        rate,
        falloff: isEcho ? 105 : 88,
        hp: isEcho ? 235 : 165,
        lp: isEcho ? 1620 : (isRecorded ? 7200 : 4200),
        attack: 0.016,
        release: 0.065
      });
      worldSync.roosterCrows++;
      return true;
    } catch (_) { return false; }
  }


  const GUQIN_PENTATONIC = [196.00, 220.00, 261.63, 293.66, 329.63, 392.00];
  function guqinPluck(x, z, noteIdx = 0) {
    if (!canPlayProcedural()) return false;
    const gx = Number.isFinite(x) ? x : listener.x;
    const gz = Number.isFinite(z) ? z : listener.z;
    try {
      const freq = GUQIN_PENTATONIC[Math.abs(noteIdx | 0) % GUQIN_PENTATONIC.length];
      const out = spatialOut(gx, gz, 0.25, { falloff: 24, life: 2.35 });
      const t = now() + 0.01;
      // Silk-string guqin: upward yin-nao pitch settle + 2nd/3rd silk harmonics + nail pluck + soundboard
      tone(out, 'triangle', freq * 0.994, freq, t, 1.48, 0.145, {
        fMid: freq * 1.001, fMidAt: 0.16, lp: 1450, attack: 0.007, body: 0.38
      });
      tone(out, 'sine', freq * 2.0, freq * 2.0, t, 0.94, 0.056, { attack: 0.006, body: 0.30 });
      tone(out, 'sine', freq * 3.0, freq * 3.0, t, 0.54, 0.022, { attack: 0.005, body: 0.24 });
      tone(out, 'sine', 118, 94, t, 0.09, 0.026, { lp: 320, attack: 0.004, body: 0.28 });
      noiseBurst(out, t, 0.018, 0.038, 'bandpass', 1750, 2.4, { pink: true, attack: 0.003 });
      // 玩家亲自弹琴时延后自动乐句，避免与自弹旋律抢音撞调
      timers.poeticMusic = Math.max(timers.poeticMusic, 28);
      return true;
    } catch (_) { return false; }
  }

  // ---- 「大音希声」生成式中国器乐留白乐层：稀疏古琴泛音 / 洞箫长音 / 远山清磬 ----
  const POETIC_SCALES = {
    bright: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25], // 宫徵清亮（春溪/桃源）
    yu:     [220.00, 261.63, 293.66, 329.63, 392.00, 440.00], // 羽调幽远（秋暮/烟雨/迷津）
    winter: [293.66, 329.63, 392.00, 440.00, 523.25, 587.33]  // 清商高寒（冬雪/登高）
  };

  function poeticAmbientOut(panVal, gainVal, life) {
    const g = ctx.createGain();
    g.gain.value = gainVal;
    const p = pannerNode();
    if (p) {
      p.pan.value = clamp(panVal, -0.72, 0.72);
      g.connect(p);
      p.connect(master);
      if (revSend) {
        const w = ctx.createGain();
        w.gain.value = 0.62;
        p.connect(w);
        w.connect(revSend);
        autoDisconnect([g, p, w], life + 0.5);
      } else {
        autoDisconnect([g, p], life + 0.5);
      }
    } else {
      g.connect(master);
      if (revSend) {
        const w = ctx.createGain();
        w.gain.value = 0.62;
        g.connect(w);
        w.connect(revSend);
        autoDisconnect([g, w], life + 0.5);
      } else {
        autoDisconnect([g], life + 0.5);
      }
    }
    return g;
  }

  function playGuqinHarmonicNote(freq, startT, panVal, level, sharedOut = null) {
    const out = sharedOut || poeticAmbientOut(panVal, level, 2.8);
    const gScale = sharedOut ? level : 1;
    tone(out, 'sine', freq * 0.996, freq, startT, 2.25, 0.125 * gScale, { fMid: freq, fMidAt: 0.14, attack: 0.012, body: 0.36 });
    tone(out, 'sine', freq * 2.0, freq * 2.0, startT, 1.55, 0.055 * gScale, { attack: 0.010, body: 0.28 });
  }

  function playXiaoBreathNote(freq, startT, dur, panVal, level, sharedOut = null) {
    const out = sharedOut || poeticAmbientOut(panVal, level, dur + 0.7);
    const gScale = sharedOut ? level : 1;
    const f = freq * 0.5;
    tone(out, 'sine', f * 0.985, f, startT, dur, 0.092 * gScale, { fMid: f * 1.003, fMidAt: 0.38, lp: 920, attack: 0.34, body: 0.62 });
    noiseBurst(out, startT, dur * 0.88, 0.024 * gScale, 'bandpass', Math.max(380, f * 3.2), 4.2, { pink: true, attack: 0.32 });
  }

  function playQingChimeNote(freq, startT, panVal, level, sharedOut = null) {
    const out = sharedOut || poeticAmbientOut(panVal, level, 3.1);
    const gScale = sharedOut ? level : 1;
    const f = freq * 2.0;
    tone(out, 'sine', f, f, startT, 2.65, 0.075 * gScale, { attack: 0.006, body: 0.28 });
    tone(out, 'sine', f * 2.756, f * 2.756, startT, 1.25, 0.018 * gScale, { attack: 0.005, body: 0.20 });
  }

  function playValleyEmergence() {
    if (!canPlayProcedural()) return false;
    try {
      const t0 = now() + 0.05;
      // 豁然开朗三叠泛音（宫 -> 徵 -> 高宫），共用单路混响母线以控节点峰值
      const bus = poeticAmbientOut(0.0, 0.34, 3.9);
      playGuqinHarmonicNote(261.63, t0, 0, 1.0, bus);
      playGuqinHarmonicNote(392.00, t0 + 0.44, 0, 0.88, bus);
      playGuqinHarmonicNote(523.25, t0 + 0.98, 0, 0.78, bus);
      playQingChimeNote(392.00, t0 + 1.12, 0, 0.52, bus);
      poeticMusic.valleyEmergences++;
      poeticMusic.lastInstrument = 'valley-emergence';
      timers.poeticMusic = Math.max(timers.poeticMusic, 22);
      return true;
    } catch (_) { return false; }
  }

  function triggerPoeticPhrase(forceMode = null) {
    if (!canPlayProcedural()) return false;
    if (!forceMode && region.cave > 0.35) return false;
    try {
      const phen = syncState.phenology || 'spring';
      const rain = clamp(ambience.rain, 0, 1);
      const night = clamp(ambience.night, 0, 1);
      const quietLift = 0.84 + 0.36 * clamp(syncState.quietBlend, 0, 1);
      const mode = forceMode || (
        (poeticMusic.lostMood || phen === 'autumn' || rain > 0.28 || syncState.timeId === 'dusk')
          ? 'xiao'
          : (phen === 'winter' || region.pineRidge > 0.24 || syncState.quietBlend > 0.55)
            ? 'qing'
            : 'guqin'
      );
      const scale = mode === 'xiao' ? POETIC_SCALES.yu : (mode === 'qing' ? POETIC_SCALES.winter : POETIC_SCALES.bright);
      const t0 = now() + 0.08;
      const panBase = rand(-0.46, 0.46);
      const softScale = userMode === 'soft' ? 0.84 : 1.0;
      const baseLevel = (mode === 'xiao' ? 0.26 : mode === 'qing' ? 0.22 : 0.25) * softScale * quietLift * (1 - rain * 0.24) * (1 - night * 0.08);
      if (mode === 'xiao') {
        const i0 = (Math.random() * 4) | 0;
        const i1 = Math.max(0, i0 + (Math.random() < 0.5 ? -1 : 1));
        const d0 = rand(2.0, 2.7);
        const play2 = Math.random() < 0.55;
        const bus = poeticAmbientOut(panBase, baseLevel, play2 ? d0 + 3.4 : d0 + 0.9);
        playXiaoBreathNote(scale[i0], t0, d0, panBase, 1.0, bus);
        if (play2) {
          playXiaoBreathNote(scale[i1], t0 + d0 + 0.25, rand(1.7, 2.3), panBase, 0.85, bus);
        }
      } else if (mode === 'qing') {
        const i0 = 1 + ((Math.random() * 4) | 0);
        const play2 = Math.random() < 0.6;
        const bus = poeticAmbientOut(panBase, baseLevel, play2 ? 4.2 : 3.0);
        playQingChimeNote(scale[i0], t0, panBase, 1.0, bus);
        if (play2) {
          playGuqinHarmonicNote(scale[Math.max(0, i0 - 1)], t0 + rand(1.0, 1.5), panBase, 0.82, bus);
        }
      } else {
        const i0 = (Math.random() * 4) | 0;
        const count = Math.random() < 0.35 ? 3 : 2;
        const bus = poeticAmbientOut(panBase, baseLevel, 2.8 + (count - 1) * 1.15);
        let off = 0;
        for (let k = 0; k < count; k++) {
          const idx = (i0 + k * (Math.random() < 0.5 ? 1 : 2)) % scale.length;
          playGuqinHarmonicNote(scale[idx], t0 + off, panBase, 1 - k * 0.14, bus);
          off += rand(0.68, 1.15);
        }
      }
      poeticMusic.phrases++;
      poeticMusic.lastInstrument = mode;
      return true;
    } catch (_) { return false; }
  }

  function gatherSound(kind, x, z) {
    if (!canPlayProcedural()) return false;
    const gx = Number.isFinite(x) ? x : listener.x;
    const gz = Number.isFinite(z) ? z : listener.z;
    try {
      const out = spatialOut(gx, gz, 0.21, { falloff: 12, dry: kind === 'fan', life: 0.85 });
      const t = now() + 0.01;
      if (kind === 'fan') {
        noiseBurst(out, t, 0.20, 0.09, 'bandpass', 1650, 0.9, { pink: true });
        tone(out, 'sine', 960, 1280, t + 0.05, 0.16, 0.04, { lp: 3200 });
      } else {
        noiseBurst(out, t, 0.14, 0.11, 'bandpass', 480, 1.1, { pink: true });
        tone(out, 'triangle', 145, 72, t, 0.12, 0.12, { lp: 650 });
        noiseBurst(out, t + 0.16, 0.11, 0.075, 'highpass', 1350, 0.7);
      }
      worldSync.gathers++;
      return true;
    } catch (_) { return false; }
  }


  function boatPole(x, z, intensity = 0.8) {
    if (!canPlayProcedural()) return false;
    const bx = Number.isFinite(x) ? x : listener.x;
    const bz = Number.isFinite(z) ? z : listener.z;
    const amp = clamp(Number(intensity) || 0.8, 0.25, 1.3);
    try {
      const out = spatialOut(bx, bz, 0.26 * amp, { falloff: 14, life: 0.68 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.16, 0.095, 'bandpass', 680, 1.1, { pink: true, freqEnd: 920 });
      noiseBurst(out, t + 0.03, 0.12, 0.06, 'bandpass', 1550, 0.9, { pink: true });
      tone(out, 'sine', 165, 92, t, 0.15, 0.08, { lp: 480 });
      worldSync.boatPoles++;
      return true;
    } catch (_) { return false; }
  }


  function poleDrip(x, z, intensity = 0.7) {
    if (!canPlayProcedural()) return false;
    const px = Number.isFinite(x) ? x : listener.x;
    const pz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(px - listener.x, pz - listener.z) > 28) return false;
    const amp = clamp(Number(intensity) || 0.7, 0.25, 1.2);
    try {
      const out = spatialOut(px, pz, 0.18 * amp, { falloff: 11, life: 0.48 });
      const t = now() + 0.008;
      for (let i = 0; i < 2; i++) {
        const dtDrop = t + i * (0.046 + rand(-0.006, 0.01));
        const f0 = (i === 0 ? 640 : 780) + rand(-55, 75);
        const f1 = f0 + 290 + rand(-30, 50);
        const dropGain = i === 0 ? 0.062 : 0.042;
        tone(out, 'sine', f0, f1, dtDrop, 0.052, dropGain, { lp: 4200, attack: 0.003, body: 0.32 });
      }
      noiseBurst(out, t + 0.004, 0.032, 0.016, 'bandpass', 1850, 2.2, { pink: true, attack: 0.003, freqEnd: 2450 });
      worldSync.poleDrips++;
      stats.drips++;
      return true;
    } catch (_) { return false; }
  }


  // 夏木远蝉：3.6–4.4 kHz 柔和带通粉噪振幅微澜，温暖悠远而不刺耳
  function cicadaShimmer(x, z) {
    if (!canPlayProcedural()) return false;
    const cx = Number.isFinite(x) ? x : listener.x;
    const cz = Number.isFinite(z) ? z : listener.z;
    try {
      const dur = 1.24 + rand(0, 0.42);
      const peak = rand(0.018, 0.028) * (1 + 0.12 * syncState.quietBlend);
      const out = spatialOut(cx, cz, 0.85, { falloff: 26, dry: true, life: dur + 0.32 });
      const t0 = now() + 0.01;
      const tEnd = t0 + dur;

      const src = ctx.createBufferSource();
      src.buffer = noise.pink;
      src.loop = true;
      src.loopStart = noise.pink._loopStart || 0;
      src.loopEnd = noise.pink.duration;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const centerHz = 3600 + rand(0, 800);
      bp.frequency.setValueAtTime(centerHz * 0.98, t0);
      bp.frequency.linearRampToValueAtTime(Math.min(4400, centerHz * 1.04), t0 + dur * 0.55);
      bp.frequency.linearRampToValueAtTime(centerHz * 0.96, tEnd);
      bp.Q.value = 3.2;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4850;
      lp.Q.value = 0.7;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      const ripples = 9 + ((Math.random() * 4) | 0);
      const stepR = dur / ripples;
      for (let i = 0; i < ripples; i++) {
        const rs = t0 + i * stepR;
        const arch = Math.sin(((i + 0.5) / ripples) * Math.PI);
        const hi = Math.max(0.0004, peak * (0.32 + 0.68 * arch));
        const lo = Math.max(0.0002, hi * 0.54);
        g.gain.linearRampToValueAtTime(hi, rs + stepR * 0.45);
        g.gain.linearRampToValueAtTime(lo, rs + stepR * 0.92);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      src.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(out);
      src.start(t0, Math.random() * Math.max(0.1, noise.pink.duration * 0.6));
      src.stop(tEnd + 0.02);
      autoDisconnect([src, bp, lp, g], dur + 0.22, src);
      worldSync.cicadas++;
      return true;
    } catch (_) { return false; }
  }


  const XUN_PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00];
  function fouBeat(x, z, stepIdx = 0) {
    if (!canPlayProcedural()) return false;
    const fx = Number.isFinite(x) ? x : listener.x;
    const fz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Math.hypot(fx - listener.x, fz - listener.z) > 38) return false;
    try {
      const accent = stepIdx % 4 === 0 ? 1.15 : 0.85;
      const out = spatialOut(fx, fz, 0.28 * accent, { falloff: 16, life: 1.18 });
      const t = now() + 0.01;
      // Deep warm clay vessel thump (击缶) + bamboo striker tap
      const vesselHz = 110 * (stepIdx % 2 === 0 ? 1.0 : 0.94);
      tone(out, 'sine', vesselHz, 64, t, 0.24, 0.13, { lp: 340, attack: 0.005, body: 0.36 });
      tone(out, 'triangle', 236, 166, t, 0.11, 0.046, { bp: 420, q: 2.2, attack: 0.004, body: 0.28 });
      noiseBurst(out, t, 0.038, 0.048, 'bandpass', 1180, 2.1, { pink: true, attack: 0.003 });
      // Alternating breathy clay ocarina (陶埙) pentatonic phrase
      if (stepIdx % 2 === 0) {
        const noteHz = XUN_PENTATONIC[(Math.floor(stepIdx / 2) + (stepIdx % 6)) % XUN_PENTATONIC.length];
        tone(out, 'sine', noteHz * 0.992, noteHz * 0.997, t + 0.06, 0.56, 0.042, {
          env: 'breath', attack: 0.09, sustain: 0.74, fMid: noteHz * 1.003, fMidAt: 0.35, lp: 640
        });
        tone(out, 'triangle', noteHz * 2.0, noteHz * 1.994, t + 0.07, 0.44, 0.012, {
          env: 'breath', attack: 0.09, sustain: 0.65, lp: 1080
        });
        noiseBurst(out, t + 0.055, 0.24, 0.016, 'bandpass', noteHz * 2.1, 2.8, { pink: true, attack: 0.05 });
      }
      worldSync.fouBeats++;
      timers.poeticMusic = Math.max(timers.poeticMusic, 28);
      return true;
    } catch (_) { return false; }
  }


  // ---- 新增风物与手工声效：流觞、劝酒、白鹿、机杼、水碓、落座 ----
  function waterCup(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 44) return false;
    try {
      const out = spatialOut(sx, sz, 0.22, { falloff: 14, life: 0.85 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.14, 0.036, 'bandpass', 1240, 1.6, { pink: true, attack: 0.018, freqEnd: 1720 });
      tone(out, 'sine', 345, 540, t + 0.015, 0.068, 0.048, { attack: 0.004, body: 0.34 });
      tone(out, 'sine', 415, 625, t + 0.078, 0.062, 0.042, { attack: 0.004, body: 0.32 });
      tone(out, 'sine', 680, 665, t + 0.038, 0.16, 0.068, { attack: 0.003, body: 0.32 });
      tone(out, 'triangle', 1385, 1355, t + 0.038, 0.075, 0.024, { lp: 3200, attack: 0.003, body: 0.24 });
      worldSync.waterCups++;
      return true;
    } catch (_) { return false; }
  }


  function toastCup(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 42) return false;
    try {
      const out = spatialOut(sx, sz, 0.24, { falloff: 14, life: 0.95 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.135, 0.044, 'bandpass', 1100, 1.8, { pink: true, attack: 0.016, freqEnd: 1500 });
      tone(out, 'sine', 340, 510, t + 0.03, 0.055, 0.036, { attack: 0.004, body: 0.32 });
      tone(out, 'sine', 395, 575, t + 0.082, 0.05, 0.032, { attack: 0.004, body: 0.30 });
      const tc = t + 0.14;
      tone(out, 'sine', 480, 474, tc, 0.24, 0.082, { attack: 0.003, body: 0.35 });
      tone(out, 'sine', 990, 978, tc, 0.14, 0.044, { attack: 0.003, body: 0.28 });
      noiseBurst(out, tc, 0.018, 0.026, 'bandpass', 1650, 2.6, { pink: true, attack: 0.002 });
      worldSync.toasts++;
      return true;
    } catch (_) { return false; }
  }


  function stagCall(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 60) return false;
    try {
      const recordedBuf = samples.pickBuffer ? samples.pickBuffer('stag') : null;
      if (recordedBuf) {
        playSpatialBuffer(recordedBuf, sx, sz, {
          gain: 0.34 * (1 + 0.15 * syncState.quietBlend),
          rate: 1.0,
          falloff: 26,
          hp: 220,
          lp: 2850,
          attack: 0.028,
          release: 0.11
        });
        worldSync.stagCalls++;
        return true;
      }
      const out = spatialOut(sx, sz, 0.24, { falloff: 22, life: 1.65 });
      const t = now() + 0.012;
      tone(out, 'triangle', 520, 430, t, 0.64, 0.088, {
        env: 'breath', attack: 0.11, sustain: 0.74, fMid: 536, fMidAt: 0.22, bp: 780, q: 2.1, lp: 1650
      });
      tone(out, 'sine', 1040, 860, t + 0.015, 0.56, 0.036, {
        env: 'breath', attack: 0.11, sustain: 0.68, bp: 1280, q: 2.4
      });
      noiseBurst(out, t + 0.01, 0.38, 0.018, 'bandpass', 920, 2.2, { pink: true, attack: 0.07, freqEnd: 740 });
      tone(out, 'sine', 880, 878, t + 0.08, 0.92, 0.026, { attack: 0.012, body: 0.36 });
      tone(out, 'sine', 1318.5, 1316, t + 0.15, 0.78, 0.018, { attack: 0.012, body: 0.32 });
      worldSync.stagCalls++;
      return true;
    } catch (_) { return false; }
  }


  function loomClack(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 36) return false;
    try {
      const out = spatialOut(sx, sz, 0.18, { falloff: 12, life: 0.68 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.075, 0.042, 'bandpass', 1850, 1.9, { pink: true, attack: 0.008, freqEnd: 2450 });
      for (let k = 0; k < 2; k++) {
        const kt = t + 0.065 + k * 0.09;
        const amp = k === 0 ? 1.0 : 0.78;
        tone(out, 'triangle', 265 + rand(-14, 14), 148, kt, 0.068, 0.095 * amp, { lp: 1250, attack: 0.003, body: 0.28 });
        noiseBurst(out, kt, 0.032, 0.052 * amp, 'bandpass', 1180 + k * 140, 2.3, { pink: true, attack: 0.003 });
      }
      worldSync.loomClacks++;
      return true;
    } catch (_) { return false; }
  }


  function mortarThud(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 42) return false;
    try {
      const out = spatialOut(sx, sz, 0.24, { falloff: 16, life: 0.85 });
      const t = now() + 0.01;
      tone(out, 'sine', 116 + rand(-6, 8), 56, t, 0.19, 0.145, { lp: 310, attack: 0.004, body: 0.36 });
      noiseBurst(out, t + 0.006, 0.085, 0.058, 'bandpass', 880, 1.5, { pink: true, attack: 0.005, freqEnd: 620 });
      tone(out, 'triangle', 228 + rand(-12, 12), 126, t + 0.024, 0.11, 0.082, { lp: 860, attack: 0.004, body: 0.30 });
      worldSync.mortarThuds++;
      return true;
    } catch (_) { return false; }
  }


  function stoolSit(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    try {
      const out = spatialOut(sx, sz, 0.20, { falloff: 10, dry: true, life: 0.62 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.14, 0.046, 'bandpass', 1650, 1.1, { pink: true, attack: 0.016, freqEnd: 1180 });
      tone(out, 'sine', 138, 82, t + 0.032, 0.13, 0.082, { lp: 380, attack: 0.005, body: 0.32 });
      tone(out, 'triangle', 345, 255, t + 0.038, 0.075, 0.034, { bp: 560, q: 2.4, attack: 0.004, body: 0.28 });
      worldSync.stoolSits++;
      return true;
    } catch (_) { return false; }
  }


  // 池岸惊蛙跃入浅水：水面下陷轻扑 + 气泡夹断上扬“噗通”空腔共鸣 + 细小回落水珠
  function frogPlop(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 40) return false;
    try {
      const clarity = 1 + 0.14 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.24 * clarity, { falloff: 15, life: 0.68 });
      const t = now() + 0.008;
      // 1) 蛙身破开水面张力的柔和下沉声
      tone(out, 'sine', 275 + rand(-14, 14), 156 + rand(-10, 10), t, 0.052, 0.058, { lp: 580, attack: 0.003, body: 0.32 });
      // 2) 入水瞬间气泡夹断的清脆上滑空腔“噗”声（Minnaert bubble glide）
      const fBub0 = 235 + rand(-16, 20);
      const fBub1 = 525 + rand(-24, 32);
      tone(out, 'sine', fBub0, fBub1, t + 0.018, 0.074, 0.084, { lp: 1480, attack: 0.004, body: 0.35 });
      tone(out, 'triangle', fBub0 * 1.98, fBub1 * 1.65, t + 0.020, 0.048, 0.022, { lp: 1950, attack: 0.004, body: 0.26 });
      // 3) 轻盈水花冠与一颗回落小水珠
      noiseBurst(out, t + 0.006, 0.068, 0.032, 'bandpass', 1120 + rand(-90, 130), 1.9, { pink: true, attack: 0.005, freqEnd: 1680 });
      const tDrop = t + 0.084 + rand(-0.006, 0.012);
      const fDrop = 560 + rand(-35, 45);
      tone(out, 'sine', fDrop, fDrop + 290 + rand(-25, 40), tDrop, 0.044, 0.030, { lp: 3200, attack: 0.003, body: 0.30 });
      worldSync.frogPlops++;
      return true;
    } catch (_) { return false; }
  }


  // 松针清露滴落青苔石：清透微凉的单颗露珠轻叩声
  function dewDrop(x, z) {
    if (!canPlayProcedural()) return false;
    const sx = Number.isFinite(x) ? x : listener.x;
    const sz = Number.isFinite(z) ? z : listener.z;
    if (hasListener && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(sx - listener.x, sz - listener.z) > 28) return false;
    try {
      const clarity = 1 + 0.16 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.14 * clarity, { falloff: 10, life: 0.42 });
      const t = now() + 0.008;
      const f0 = 840 + rand(-45, 65);
      const f1 = f0 + 440 + rand(-35, 55);
      tone(out, 'sine', f0, f1, t, 0.048, 0.042, { lp: 4200, attack: 0.003, body: 0.30 });
      tone(out, 'triangle', f0 * 2.02, f1 * 1.62, t + 0.002, 0.028, 0.014, { lp: 5200, attack: 0.003, body: 0.24 });
      worldSync.dewDrops++;
      stats.drips++;
      return true;
    } catch (_) { return false; }
  }


  // 北涧飞泉深潭溅珠与清渠水响
  function cascadeSplash(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : borderlandAnchors.cascade.x;
      const sz = Number.isFinite(z) ? z : borderlandAnchors.cascade.z;
      const clarity = 1 + 0.2 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.14 * clarity, { falloff: 16, life: 0.85 });
      const t = now() + 0.01;
      noiseBurst(out, t, 0.14, 0.036, 'bandpass', 1650 + rand(-180, 260), 1.4, { pink: true, attack: 0.012, freqEnd: 2350 });
      const drops = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < drops; i++) {
        const td = t + i * (0.068 + rand(0, 0.028));
        const f0 = 410 + rand(-35, 110);
        tone(out, 'sine', f0, f0 + 260 + rand(0, 90), td, 0.058, 0.038, { lp: 3200, attack: 0.004, body: 0.32 });
      }
      worldSync.cascadeSplashes++;
      stats.gurgles++;
      return true;
    } catch (_) { return false; }
  }


  // 云间双鹤清唳（高空悠远双音，送入山谷混响）
  function craneCall(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : 24.5;
      const sz = Number.isFinite(z) ? z : -239.5;
      const clarity = 1 + 0.22 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.13 * clarity, { falloff: 38, life: 1.45 });
      const t = now() + 0.015;
      // 第一声清亮鹤鸣 + 泛音
      tone(out, 'triangle', 940 + rand(-25, 25), 880, t, 0.34, 0.034, {
        fMid: 1120, fMidAt: 0.26, bp: 1080, q: 2.2, env: 'swell', attack: 0.055, sustain: 0.68
      });
      tone(out, 'sine', 1880, 1760, t + 0.01, 0.28, 0.012, {
        fMid: 2240, fMidAt: 0.26, lp: 3400, env: 'swell', attack: 0.05, sustain: 0.55
      });
      // 第二声短促应和
      tone(out, 'triangle', 1080 + rand(-20, 25), 930, t + 0.39, 0.26, 0.026, {
        fMid: 1190, fMidAt: 0.22, bp: 1150, q: 2.4, env: 'swell', attack: 0.04, sustain: 0.60
      });
      worldSync.craneCalls++;
      stats.chirps++;
      return true;
    } catch (_) { return false; }
  }


  // 东皋散牧山羊温软轻咩（低通柔和三叠轻颤，绝不刺耳）
  function goatBleat(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : borderlandAnchors.eastPasture.x;
      const sz = Number.isFinite(z) ? z : borderlandAnchors.eastPasture.z;
      const quietScale = 1 - 0.15 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.11 * quietScale, { falloff: 22, life: 0.95 });
      const t = now() + 0.012;
      const baseF = 305 + rand(-18, 28);
      for (let i = 0; i < 3; i++) {
        const tp = t + i * 0.088;
        const f0 = baseF + (i === 1 ? 26 : 0);
        const f1 = baseF - 18 + i * 4;
        tone(out, 'triangle', f0, f1, tp, 0.11, 0.026 * (1 - i * 0.12), {
          bp: 680, q: 1.5, lp: 1350, env: 'swell', attack: 0.022, sustain: 0.72
        });
      }
      worldSync.goatBleats++;
      stats.lows++;
      return true;
    } catch (_) { return false; }
  }


  // 西坞山泉竹炉与碧涧茶坞泥灶：微沸蒸汽、蟹眼水泡与可选松柴余烬轻响
  function teaSimmer(x, z, opts) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : borderlandAnchors.teaStove.x;
      const sz = Number.isFinite(z) ? z : borderlandAnchors.teaStove.z;
      const maxDist = opts && Number.isFinite(opts.maxDist) ? opts.maxDist : Infinity;
      if (hasListener && Number.isFinite(maxDist) && Math.hypot(sx - listener.x, sz - listener.z) > maxDist) {
        return false;
      }
      const clarity = 1 + 0.22 * syncState.quietBlend;
      const gainScale = clamp(opts && Number.isFinite(opts.gainScale) ? opts.gainScale : 1, 0.2, 1.5);
      const out = spatialOut(sx, sz, 0.12 * clarity * gainScale, { falloff: 10, dry: true, life: 0.72 });
      const t = now() + 0.008;
      // 轻柔蒸汽白雾嘶鸣
      noiseBurst(out, t, 0.28, 0.018, 'bandpass', 2150 + rand(-150, 180), 1.6, { pink: true, attack: 0.04, freqEnd: 2650 });
      // 蟹眼水泡轻沸
      for (let i = 0; i < 3; i++) {
        const tb = t + 0.03 + i * (0.075 + rand(0, 0.03));
        const fb = 510 + rand(-40, 140);
        tone(out, 'sine', fb, fb + 190, tb, 0.045, 0.022, { lp: 2600, attack: 0.004, body: 0.28 });
      }
      if (opts && opts.withEmberCrackle) {
        noiseBurst(out, t + 0.02, 0.024, 0.022, 'bandpass', 2250 + rand(-260, 320), 2.3, { attack: 0.002 });
        tone(out, 'sine', 150, 92, t + 0.015, 0.085, 0.016, { lp: 300, attack: 0.008, body: 0.28 });
      }
      worldSync.teaSimmers++;
      stats.drips++;
      return true;
    } catch (_) { return false; }
  }

  // 北涧冷泉幽轩：崖间竹笕引泉落入苔石方池的清泠水声
  function bambooSpring(x, z, opts) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : deepHollowAnchors.coldSpring.x;
      const sz = Number.isFinite(z) ? z : deepHollowAnchors.coldSpring.z;
      const maxDist = opts && Number.isFinite(opts.maxDist) ? opts.maxDist : 36;
      if (hasListener && Number.isFinite(sx) && Number.isFinite(sz) && Math.hypot(sx - listener.x, sz - listener.z) > maxDist) {
        return false;
      }
      const clarity = 1 + 0.24 * syncState.quietBlend;
      const winterScale = syncState.phenology === 'winter' ? 0.65 : 1.0;
      const gainScale = clamp(opts && Number.isFinite(opts.gainScale) ? opts.gainScale : 1, 0.2, 1.5);
      const out = spatialOut(sx, sz, 0.14 * clarity * winterScale * gainScale, { falloff: 11, life: 0.68 });
      const t = now() + 0.008;
      // 竹笕口轻缓细流嘶鸣
      noiseBurst(out, t, 0.22, 0.016, 'bandpass', 1420 + rand(-120, 140), 1.7, { pink: true, attack: 0.025, freqEnd: 1750 });
      // 落入苔石池面的清越水滴声（2~3 滴错落）
      const drops = 2 + (Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < drops; i++) {
        const dtDrop = t + 0.025 + i * (0.095 + rand(0, 0.04));
        const f0 = 760 + rand(-70, 95);
        tone(out, 'sine', f0, f0 * 1.44, dtDrop, 0.062, 0.042, { lp: 4200, attack: 0.003, body: 0.34 });
      }
      worldSync.springDrips++;
      stats.drips++;
      return true;
    } catch (_) { return false; }
  }


  // 临水石子打水漂：随跳跃次数逐跳清脆微升的水花轻响
  function stoneSkip(x, z, hopIdx = 0) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : listener.x;
      const sz = Number.isFinite(z) ? z : listener.z;
      const hop = clamp(hopIdx | 0, 0, 6);
      const decay = Math.pow(0.84, hop);
      const out = spatialOut(sx, sz, 0.22 * decay, { falloff: 15, life: 0.55 });
      const t = now() + 0.006;
      const f0 = (410 + hop * 68) + rand(-18, 22);
      tone(out, 'sine', f0, f0 * 1.46, t, 0.056, 0.068, { lp: 3800, attack: 0.003, body: 0.30 });
      noiseBurst(out, t, 0.048, 0.036, 'bandpass', 1650 + hop * 180, 1.7, { pink: true, attack: 0.003, freqEnd: 2450 });
      worldSync.stoneSkips++;
      stats.gurgles++;
      return true;
    } catch (_) { return false; }
  }


  // 舟中听雨：雨点轻敲船尾竹编箬篷的近耳温润笃笃声
  function canopyRain(x, z, intensity = 0.7) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : listener.x;
      const sz = Number.isFinite(z) ? z : listener.z;
      const amp = clamp(Number(intensity) || 0.7, 0.2, 1.2);
      const out = spatialOut(sx, sz, 0.14 * amp, { falloff: 8, dry: true, life: 0.28 });
      const t = now() + 0.006;
      const f0 = 285 + rand(-35, 95);
      tone(out, 'triangle', f0, f0 * 0.74, t, 0.042, 0.046, { bp: 520, q: 1.8, lp: 1650, attack: 0.002, body: 0.25 });
      noiseBurst(out, t, 0.032, 0.028, 'bandpass', 1950 + rand(-250, 320), 1.4, { pink: true, attack: 0.002 });
      worldSync.canopyRains++;
      stats.drops++;
      return true;
    } catch (_) { return false; }
  }


  // 东岭烂柯石枰：苍松下溪石棋子轻叩青石盘面的清越单响
  function goStoneClick(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : borderlandAnchors.lanke.x;
      const sz = Number.isFinite(z) ? z : borderlandAnchors.lanke.z;
      const out = spatialOut(sx, sz, 0.16 * (1 + 0.2 * syncState.quietBlend), { falloff: 16, life: 0.45 });
      const t = now() + 0.008;
      tone(out, 'sine', 1460 + rand(-60, 80), 1180, t, 0.048, 0.048, { lp: 4200, attack: 0.002, body: 0.22 });
      tone(out, 'triangle', 2860 + rand(-90, 90), 2320, t, 0.026, 0.022, { lp: 5200, attack: 0.002, body: 0.18 });
      noiseBurst(out, t, 0.018, 0.024, 'bandpass', 2250, 2.6, { pink: true, attack: 0.002 });
      worldSync.goStoneClicks++;
      stats.clatters++;
      return true;
    } catch (_) { return false; }
  }


  // 山阿秦汉古窑：干松柴在馒头窑膛内温暖毕剥微响
  function kilnCrackle(x, z) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : borderlandAnchors.kiln.x;
      const sz = Number.isFinite(z) ? z : borderlandAnchors.kiln.z;
      const out = spatialOut(sx, sz, 0.11, { falloff: 12, dry: true, life: 0.36 });
      const t = now() + 0.008;
      noiseBurst(out, t, 0.022, 0.032, 'bandpass', 2100 + rand(-300, 450), 2.4, { attack: 0.002 });
      if (Math.random() < 0.55) {
        noiseBurst(out, t + 0.045 + rand(0, 0.03), 0.018, 0.022, 'bandpass', 2650, 2.8, { attack: 0.002 });
      }
      tone(out, 'sine', 142, 86, t, 0.09, 0.022, { lp: 280, attack: 0.008, body: 0.32 });
      worldSync.kilnCrackles++;
      stats.rustles++;
      return true;
    } catch (_) { return false; }
  }


  // 晒场火塘五声击缶应和（直驱宫商角徵羽 0..4）
  function fouTone(x, z, noteIdx = 0) {
    if (!canPlayProcedural()) return false;
    const fx = Number.isFinite(x) ? x : listener.x;
    const fz = Number.isFinite(z) ? z : listener.z;
    try {
      const idx = Math.abs(noteIdx | 0) % XUN_PENTATONIC.length;
      const noteHz = XUN_PENTATONIC[idx];
      const out = spatialOut(fx, fz, 0.28, { falloff: 18, life: 1.25 });
      const t = now() + 0.008;
      tone(out, 'sine', 106 + idx * 8, 64, t, 0.24, 0.125, { lp: 340, attack: 0.005, body: 0.36 });
      noiseBurst(out, t, 0.034, 0.042, 'bandpass', 1180, 2.1, { pink: true, attack: 0.003 });
      tone(out, 'sine', noteHz * 0.994, noteHz, t + 0.035, 0.62, 0.052, {
        env: 'breath', attack: 0.075, sustain: 0.74, fMid: noteHz * 1.003, fMidAt: 0.32, lp: 780
      });
      tone(out, 'triangle', noteHz * 2.0, noteHz * 1.996, t + 0.045, 0.45, 0.015, {
        env: 'breath', attack: 0.08, sustain: 0.62, lp: 1280
      });
      worldSync.fouBeats++;
      timers.poeticMusic = Math.max(timers.poeticMusic, 28);
      return true;
    } catch (_) { return false; }
  }


  // 武陵渡口：系泊竹筏随波轻磕杉木桩的空心竹木微响与浅水轻拍
  function raftKnock(x, z, intensity = 0.65) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : listener.x;
      const sz = Number.isFinite(z) ? z : listener.z;
      const amp = clamp(Number(intensity) || 0.65, 0.25, 1.0);
      const clarity = 1 + 0.16 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.14 * amp * clarity, { falloff: 16, life: 0.48 });
      const t = now() + 0.008;
      // 空心老毛竹低沉木腔共振 + 湿杉木轻叩
      const fBody = 212 + rand(-16, 22);
      tone(out, 'sine', fBody, fBody * 0.78, t, 0.095, 0.058, { bp: 560, q: 1.6, lp: 1200, attack: 0.003, body: 0.30 });
      tone(out, 'triangle', 455 + rand(-30, 35), 355, t + 0.004, 0.052, 0.026, { lp: 1500, attack: 0.002, body: 0.22 });
      // 紧随木磕后的微弱溪水拍筏声
      noiseBurst(out, t + 0.042, 0.11, 0.022, 'bandpass', 780 + rand(-90, 120), 1.5, { pink: true, attack: 0.015, freqEnd: 520 });
      worldSync.raftKnocks++;
      stats.clatters++;
      return true;
    } catch (_) { return false; }
  }


  // 武陵渡口：晒网架悬垂麻网随溪风轻拂与竹架微颤声
  function netRustle(x, z, intensity = 0.6) {
    if (!canPlayProcedural()) return false;
    try {
      const sx = Number.isFinite(x) ? x : listener.x;
      const sz = Number.isFinite(z) ? z : listener.z;
      const amp = clamp(Number(intensity) || 0.6, 0.25, 1.0);
      const clarity = 1 + 0.20 * syncState.quietBlend;
      const out = spatialOut(sx, sz, 0.12 * amp * clarity, { falloff: 13, dry: true, life: 0.54 });
      const t = now() + 0.008;
      noiseBurst(out, t, 0.32, 0.020, 'bandpass', 2250 + rand(-220, 260), 1.9, { pink: true, attack: 0.06, freqEnd: 1720 });
      tone(out, 'sine', 630 + rand(-35, 45), 575, t + 0.05, 0.14, 0.0085, { bp: 720, q: 2.2, lp: 1450, env: 'swell', attack: 0.035, sustain: 0.55 });
      worldSync.netRustles++;
      stats.rustles++;
      return true;
    } catch (_) { return false; }
  }


  function clatter(x, z) {
    const quietScale = 1 - 0.42 * syncState.quietBlend;
    const out = spatialOut(x, z, 0.16 * quietScale, { falloff: 12, life: 0.45 });
    const t = now() + 0.01;
    noiseBurst(out, t, 0.07, 0.085, 'bandpass', 900 + rand(-200, 300), 2.2, { pink: true });
    tone(out, 'sine', 300 + rand(-60, 60), 180, t, 0.12, 0.078, { lp: 1100 });
    if (Math.random() < 0.5) tone(out, 'triangle', 720, 520, t + 0.06, 0.08, 0.03, { lp: 2400 });
    stats.clatters++;
  }

  function gurgle(x, z) {
    const clarity = 1 + 0.18 * syncState.quietBlend;
    if (samples.play('river', { x, z, gain: 0.18 * region.river * clarity, ambient: true, emitterId: 'river', falloff: 18 })) { stats.gurgles++; return; }
    // Regional procedural water babble: 2-4 staggered bubble pops + pitch-rising droplet plinks (320 -> 580Hz)
    const out = spatialOut(x, z, 0.15 * clarity, { falloff: 12, life: 0.78 });
    const t = now() + 0.01;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const dtDrop = t + i * (0.072 + rand(0, 0.03));
      const fStart = 320 + rand(0, 95);
      const fEnd = Math.min(580, fStart + 135 + rand(0, 65));
      tone(out, 'sine', fStart, fEnd, dtDrop, 0.064, 0.044, { attack: 0.004, body: 0.34 });
      noiseBurst(out, dtDrop, 0.042, 0.024, 'bandpass', 960 + rand(-140, 240), 2.2, { pink: true, attack: 0.004, freqEnd: 1380 });
    }
    stats.gurgles++;
  }

  function rainDrop(x, z) {
    const out = spatialOut(x, z, 0.04, { falloff: 10, dry: true, life: 0.18 });
    const t = now() + 0.01;
    noiseBurst(out, t, 0.03, 0.05, 'highpass', 2800, 0.7);
    stats.drops++;
  }

  function dogFar(x, z) {
    const played = animalSample('bark', x, z, { gain: 0.15, ambient: true, falloff: 32, emitterId: 'ambient-dog' });
    if (played) stats.barks++;
    return played;
  }

  function leafRustle(x, z) {
    const clarity = 1 + 0.18 * syncState.quietBlend;
    const isAutumn = syncState.phenology === 'autumn';
    const samplePlayed = samples.play('leaves', {
      x, z,
      gain: 0.18 * ambience.wind * clarity * (isAutumn ? 1.12 : 1.0),
      ambient: true,
      emitterId: 'leaves',
      falloff: 20
    });
    if (samplePlayed) {
      if (isAutumn && ambience.rain < 0.55) {
        const crispOut = spatialOut(x, z, 0.065 * clarity, { falloff: 18, dry: true, life: 0.45 });
        const tc = now() + 0.015;
        noiseBurst(crispOut, tc, 0.24, 0.026, 'bandpass', 5850, 0.9, { attack: 0.015 });
      }
      stats.rustles++;
      return;
    }
    // The existing filtered wind remains when a recording is unavailable/cooling down.
    const out = spatialOut(x, z, 0.1 * clarity * (isAutumn ? 1.15 : 1.0), { falloff: 20, dry: true, life: 0.65 });
    const t = now() + 0.01;
    noiseBurst(out, t, 0.42, 0.045, 'bandpass', isAutumn ? 3650 : 3200, 0.55, { pink: true });
    noiseBurst(out, t + 0.06, 0.28, isAutumn ? 0.038 : 0.03, 'bandpass', isAutumn ? 5950 : 5200, 0.65);
    stats.rustles++;
  }

  // ---- 脚步与狭洞声场辅助 ----
  function nearestPolylinePoint(x, z, pts, outObj) {
    if (!Array.isArray(pts) || pts.length < 2) return Infinity;
    let bestSq = Infinity;
    let bx = x, bz = z;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      if (!p0 || !p1) continue;
      const ax = p0[0], az = p0[1];
      const vx = p1[0] - ax, vz = p1[1] - az;
      const lenSq = vx * vx + vz * vz;
      const u = lenSq > 1e-6 ? clamp(((x - ax) * vx + (z - az) * vz) / lenSq, 0, 1) : 0;
      const qx = ax + vx * u;
      const qz = az + vz * u;
      const dx = x - qx;
      const dz = z - qz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        bx = qx;
        bz = qz;
      }
    }
    if (outObj) {
      outObj.x = bx;
      outObj.z = bz;
    }
    return Math.sqrt(bestSq);
  }

  function pointToPolylineDist(x, z, pts) {
    return nearestPolylinePoint(x, z, pts, null);
  }

  function cavePassageFactor(x, z) {
    const slit = deps.cliff && deps.cliff.slit;
    if (!slit || !Number.isFinite(slit.x) || !Number.isFinite(slit.z)) return 0;
    if (!Number.isFinite(slit.angle)) {
      return 1 - smoothstep(9, 33, Math.hypot(x - slit.x, z - slit.z));
    }
    const ux = Math.cos(slit.angle);
    const uz = Math.sin(slit.angle);
    const dx = x - slit.x;
    const dz = z - slit.z;
    const along = dx * ux + dz * uz;
    const lat = -dx * uz + dz * ux;
    const clampedS = clamp(along, -25.0, 15.5);
    const corridorDist = Math.hypot(Math.abs(along - clampedS), Math.max(0, Math.abs(lat) - 2.2));
    if (corridorDist <= 5.0) {
      return 0.85 + 0.15 * (1 - smoothstep(0, 5.0, corridorDist));
    }
    return 0.85 * (1 - smoothstep(5.0, 26.0, corridorDist));
  }

  function isInCavePassage(x, z) {
    const slit = deps.cliff && deps.cliff.slit;
    if (!slit || !Number.isFinite(slit.x) || !Number.isFinite(slit.z) || !Number.isFinite(slit.angle)) return false;
    const ux = Math.cos(slit.angle);
    const uz = Math.sin(slit.angle);
    const dx = x - slit.x;
    const dz = z - slit.z;
    const along = dx * ux + dz * uz;
    const lat = -dx * uz + dz * ux;
    return along >= -25.2 && along <= 15.8 && Math.abs(lat) < 3.2;
  }

  // ---- 脚步：按地表换材质，落脚时还有一点身体下沉的低频 ----
  function stepSurface(x, z) {
    const groundMat = deps.field && typeof deps.field.surfaceMaterial === 'function'
      ? deps.field.surfaceMaterial(x, z)
      : null;
    if (deps.isOnWood?.(x, z) || groundMat === 'wood') return 'wood';
    if (deps.isWading?.(x, z)) return 'water';
    const elevatedStone = groundMat === 'stone' && deps.field && typeof deps.field.walkSurface === 'function'
      && deps.field.walkSurface(x, z) > (world.terrain.waterLevel + 0.22);
    if (!elevatedStone) {
      if (pond && Math.hypot(x - pond.x, z - pond.z) < (pond.waterRadius || pond.radius * 0.68)) return 'water';
      if (deps.field) {
        const y = deps.field.sample(x, z);
        if (y < (world.terrain.waterLevel + 0.18)) return 'water';
      }
    }
    if (region.cave > 0.32 || isInCavePassage(x, z)) return 'stone';
    if (groundMat === 'stone') return 'stone';
    for (let i = 0; i < borderlandAnchors.stoneSpots.length; i++) {
      const sp = borderlandAnchors.stoneSpots[i];
      if (Math.hypot(x - sp.x, z - sp.z) <= sp.r) return 'stone';
    }
    for (let i = 0; i < borderlandAnchors.flagstoneTrails.length; i++) {
      if (pointToPolylineDist(x, z, borderlandAnchors.flagstoneTrails[i]) < 1.15) return 'stone';
    }
    if (houses.length) {
      let min = Infinity;
      for (let i = 0; i < houses.length; i++) {
        const h = houses[i];
        const dCenter = Math.hypot(h.x - x, h.z - z);
        if (dCenter < min) min = dCenter;
        if (Number.isFinite(h.doorX) && Number.isFinite(h.doorZ)) {
          const dDoor = Math.hypot(h.doorX - x, h.doorZ - z);
          if (dDoor < min) min = dDoor;
        }
      }
      if (min < 4.8) return 'stone';
    }
    if (groundMat === 'dirt') return 'dirt';
    const road = world.village && world.village.road;
    if (road && Array.isArray(road.points)) {
      if (pointToPolylineDist(x, z, road.points) < ((road.width || 3.4) * 0.5 + 0.95)) return 'dirt';
      const paths = world.hinterland && world.hinterland.paths;
      if (Array.isArray(paths)) {
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (p && pointToPolylineDist(x, z, p.points) < ((p.width || 2.0) * 0.5 + 0.65)) return 'dirt';
        }
      }
      for (let i = 0; i < houses.length; i++) {
        const spur = houses[i].spur;
        if (spur && spur.pts && pointToPolylineDist(x, z, spur.pts) < ((spur.width || 1.2) * 0.5 + 0.55)) return 'dirt';
      }
      for (let i = 0; i < borderlandAnchors.dirtTrails.length; i++) {
        if (pointToPolylineDist(x, z, borderlandAnchors.dirtTrails[i]) < 1.35) return 'dirt';
      }
    } else if (villageCenter && Math.hypot(villageCenter.x - x, villageCenter.z - z) < 32) {
      return 'dirt';
    }
    return 'grass';
  }

  function footstep(surface, running) {
    if (!canRunProcedural()) return;
    const quietScale = 1 - 0.35 * syncState.quietBlend;
    const level = (SC.footsteps && SC.footsteps.gain || 0.5) * (running ? 1.15 : 0.85) * quietScale;
    const p = pannerNode();
    const out = ctx.createGain();
    out.gain.value = level * 0.7;
    const owned = [out];
    let tail = out;
    if (p) {
      p.pan.value = stepSide * 0.13;
      out.connect(p);
      tail = p;
      owned.push(p);
    }
    tail.connect(master);
    if (region.cave > 0.12 && caveSend) {
      const send = ctx.createGain();
      send.gain.value = clamp((region.cave - 0.12) * 0.88, 0.05, 0.78);
      tail.connect(send);
      send.connect(caveSend);
      owned.push(send);
    }
    stepSide *= -1;
    const t = now() + 0.01;
    if (surface === 'water') {
      noiseBurst(out, t, 0.16, 0.085, 'bandpass', 1150, 0.9, { pink: true, attack: 0.012, freqEnd: 1750 });
      tone(out, 'sine', 240, 390, t + 0.015, 0.13, 0.046, { attack: 0.005, body: 0.34 });
      tone(out, 'sine', 110, 68, t, 0.12, 0.045, { lp: 280, attack: 0.005, body: 0.30 });
      for (let i = 0; i < 2; i++) {
        tone(out, 'sine', 520 + rand(-60, 90), 780 + rand(-35, 55), t + 0.055 + i * 0.04, 0.055, 0.024, {
          lp: 3400, attack: 0.003, body: 0.30
        });
      }
      stepMaterials.water++;
      stats.steps++;
      autoDisconnect(owned, 0.48);
      return;
    }
    if (surface === 'wood') {
      // 温润空腔木桥/栈道板声：低频板腔共鸣 + 轻巧木纹泛音 + 鞋底干脆叩击
      tone(out, 'triangle', 142 + rand(-7, 7), 90, t, 0.135, 0.108, { lp: 430, attack: 0.004, body: 0.38 });
      tone(out, 'sine', 660 + rand(-28, 28), 490, t + 0.004, 0.058, 0.044, { bp: 660, q: 2.3, attack: 0.003, body: 0.28 });
      noiseBurst(out, t, 0.046, 0.036, 'bandpass', 1180 + rand(-90, 90), 1.6, { pink: true, attack: 0.003 });
      stepMaterials.wood++;
      stats.steps++;
      autoDisconnect(owned, 0.48);
      return;
    }
    // 冬寂物候下户外草地/土路踏雪微响（石板、洞穴、屋檐棚下及木桥/涉水保持原音色）
    if (syncState.phenology === 'winter' && (surface === 'grass' || surface === 'dirt') && region.cave < 0.25 && syncState.shelter < 0.55) {
      const snowDepth = surface === 'grass'
        ? (0.76 + 0.24 * clamp(syncState.snow || 0, 0, 1))
        : (0.58 + 0.34 * clamp(syncState.snow || 0, 0, 1));
      // 柔和压雪低频承托 + 冰晶酥脆双段咯吱
      tone(out, 'sine', 78 + rand(-6, 6), 48, t, 0.105, 0.064 * snowDepth, { lp: 190, attack: 0.006, body: 0.30 });
      noiseBurst(out, t, 0.088, 0.056 * snowDepth, 'bandpass', 1680 + rand(-180, 220), 1.45, { pink: true, attack: 0.012, freqEnd: 1240 });
      noiseBurst(out, t + 0.036, 0.062, 0.034 * snowDepth, 'bandpass', 2650 + rand(-240, 280), 1.8, { pink: true, attack: 0.008, freqEnd: 2100 });
      worldSync.snowSteps++;
      stepMaterials.snow++;
      stats.steps++;
      autoDisconnect(owned, 0.48);
      return;
    }
    if (surface === 'stone') {
      // 青石桥/亭台/石径：紧实微脆履底清叩 + 细砂石质瞬态
      tone(out, 'sine', 108 + rand(-8, 8), 64, t, 0.078, 0.072, { lp: 260, attack: 0.003, body: 0.26 });
      noiseBurst(out, t, 0.048, 0.056, 'bandpass', 2620 + rand(-160, 180), 1.55, { attack: 0.002 });
      noiseBurst(out, t + 0.008, 0.044, 0.034, 'bandpass', 1280 + rand(-110, 110), 1.5, { pink: true, attack: 0.003 });
      stepMaterials.stone++;
    } else if (surface === 'dirt') {
      // 村中夯土大道/晒谷坪/田埂：沉稳土压低频 + 干土砂砾微擦
      tone(out, 'sine', 88 + rand(-6, 6), 55, t, 0.092, 0.076, { lp: 210, attack: 0.004, body: 0.30 });
      noiseBurst(out, t, 0.076, 0.052, 'bandpass', 960 + rand(-90, 100), 0.9, { pink: true, attack: 0.004 });
      noiseBurst(out, t + 0.014, 0.045, 0.028, 'bandpass', 1820 + rand(-140, 140), 1.25, { pink: true, attack: 0.003 });
      stepMaterials.dirt++;
    } else {
      // 芳草坡地/林间草坪：柔和落脚承托 + 轻拂草叶沙沙声
      tone(out, 'sine', 82 + rand(-6, 6), 52, t, 0.095, 0.062, { lp: 195, attack: 0.006, body: 0.28 });
      noiseBurst(out, t, 0.092, 0.044, 'bandpass', 1420 + rand(-120, 140), 0.75, { pink: true, attack: 0.008, freqEnd: 1020 });
      noiseBurst(out, t + 0.012, 0.055, 0.022, 'highpass', 3050, 0.7, { attack: 0.006 });
      stepMaterials.grass++;
    }
    stats.steps++;
    autoDisconnect(owned, 0.48);
  }

  let lfoClock = 0;

  // ---- 每帧更新：先定位听者，再决定各层环境音和偶发事件 ----
  function updateRegion(px, pz, dt) {
    const prevRiver = region.river;
    const prevPond = region.pond;
    const prevCave = region.cave;
    const prevVillage = region.village;
    const riverD = deps.distanceToRiver ? deps.distanceToRiver(px, pz) : Infinity;
    const nextRiver = 1 - smoothstep(7, 64, riverD);
    let nextPond = 0;
    if (pond) {
      const pd = Math.hypot(px - pond.x, pz - pond.z) - (pond.waterRadius || pond.radius * 0.7);
      nextPond = 1 - smoothstep(2, 34, Math.max(0, pd));
    }
    const baseCave = cavePos ? (1 - smoothstep(9, 33, Math.hypot(px - cavePos.x, pz - cavePos.z))) : 0;
    const nextCave = Math.max(baseCave, cavePassageFactor(px, pz));

    // 山口「声学洞穴突变」（Acoustic Portal）：狭缝内隔绝外溪风叶，出谷瞬间低通如画卷豁然铺展
    let targetTunnelOcc = 0;
    const slit = deps.cliff && deps.cliff.slit;
    if (slit && Number.isFinite(slit.x) && Number.isFinite(slit.z) && Number.isFinite(slit.angle)) {
      const ux = Math.cos(slit.angle);
      const uz = Math.sin(slit.angle);
      const dx = px - slit.x;
      const dz = pz - slit.z;
      const along = dx * ux + dz * uz;
      const lat = Math.abs(-dx * uz + dz * ux);
      if (lat < 4.2 && along >= -25.5 && along <= 16.5) {
        const innerFade = smoothstep(-25.5, -18.5, along);
        const outerFade = 1 - smoothstep(10.0, 16.5, along);
        const latFade = 1 - smoothstep(2.2, 4.2, lat);
        targetTunnelOcc = clamp(innerFade * outerFade * latFade, 0, 1);
      }
      if (targetTunnelOcc > 0.58) {
        syncState.wasDeepInTunnel = true;
      } else if (along > 18.0 || lat > 9.0) {
        syncState.wasDeepInTunnel = false;
      }
      if (syncState.portalBloomCooldown > 0) {
        syncState.portalBloomCooldown = Math.max(0, syncState.portalBloomCooldown - dt);
      }
      if (syncState.wasDeepInTunnel && along < -21.2 && lat < 7.5 && syncState.portalBloomCooldown <= 0) {
        syncState.wasDeepInTunnel = false;
        syncState.portalBloom = 0;
        syncState.portalBloomCooldown = 14.0;
        worldSync.portalBlooms++;
        if (canPlayProcedural()) {
          bird(px - 12, pz - 22, 0.72);
          dogFar(px + 26, pz - 68);
        }
      }
    }
    const occTc = targetTunnelOcc > syncState.tunnelOcclusion ? 0.26 : 0.58;
    syncState.tunnelOcclusion += (targetTunnelOcc - syncState.tunnelOcclusion) * (1 - Math.exp(-dt / occTc));
    if (syncState.portalBloom < 1) {
      syncState.portalBloom = Math.min(1, syncState.portalBloom + dt / 1.95);
    }
    // 村子沿路展开，用「最近一栋房子」而不是几何中心，否则站在村口会听不到人声
    let nextVillage = 0;
    if (houses.length) {
      let nearest = Infinity;
      for (let i = 0; i < houses.length; i++) {
        const d = Math.hypot(px - houses[i].x, pz - houses[i].z);
        if (d < nearest) nearest = d;
      }
      nextVillage = 1 - smoothstep(8, 44, nearest);
    } else if (villageCenter) {
      nextVillage = 1 - smoothstep(22, villageRadius, Math.hypot(px - villageCenter.x, pz - villageCenter.z));
    }
    const blend = 1 - Math.exp(-dt / 1.6);
    const caveBlend = 1 - Math.exp(-dt / (nextCave > prevCave ? 0.52 : 1.15));
    region.river = prevRiver + (nextRiver - prevRiver) * blend;
    region.pond = prevPond + (nextPond - prevPond) * blend;
    region.cave = prevCave + (nextCave - prevCave) * caveBlend;
    region.village = prevVillage + (nextVillage - prevVillage) * blend;

    // 北涧三叠飞泉、清渠与东皋/西坞苍松岭方位衰减
    const cascD = Math.hypot(px - borderlandAnchors.cascade.x, pz - borderlandAnchors.cascade.z);
    const nextCascade = 1 - smoothstep(6, 62, cascD);
    const brookD = nearestPolylinePoint(px, pz, borderlandAnchors.brook, lastBrookPt);
    const nextBrook = 1 - smoothstep(2.5, 28, brookD);
    let nextPine = 0;
    let bestPine = borderlandAnchors.pineRidges[0];
    for (let i = 0; i < borderlandAnchors.pineRidges.length; i++) {
      const pr = borderlandAnchors.pineRidges[i];
      const wPine = 1 - smoothstep(8, pr.r, Math.hypot(px - pr.x, pz - pr.z));
      if (wPine > nextPine) {
        nextPine = wPine;
        bestPine = pr;
      }
    }
    activePineAnchor.x = bestPine.x;
    activePineAnchor.z = bestPine.z;
    const borderBlend = 1 - Math.exp(-dt / 1.25);
    region.cascade = region.cascade + (nextCascade - region.cascade) * borderBlend;
    region.brook = region.brook + (nextBrook - region.brook) * borderBlend;
    region.pineRidge = region.pineRidge + (nextPine - region.pineRidge) * borderBlend;
  }

  function applyBeds(immediate, dt, elapsed) {
    if (!ready || !beds) return;
    const step = dt === undefined ? 0.016 : dt;
    const e = Number.isFinite(elapsed) ? elapsed : lfoClock;
    const qf = clamp(syncState.quietBlend, 0, 1);
    const natureBoost = 1 + 0.18 * qf;
    const clutterScale = 1 - 0.25 * qf;
    const w = clamp(ambience.wind, 0, 1);
    const portalOcc = clamp(syncState.tunnelOcclusion, 0, 1);
    const bloomOpen = smoothstep(0, 1, clamp(syncState.portalBloom, 0, 1));
    const portalDuck = (1 - 0.82 * portalOcc) * (0.38 + 0.62 * bloomOpen);
    const gust = 0.7 + 0.3 * Math.sin(windPhase) + 0.12 * Math.sin(windPhase * 2.7 + 1.2);
    const windBase = (0.55 + 0.45 * w) * gust * (1 - 0.7 * region.cave) * portalDuck;
    const tc = immediate ? 0.05 : 0.3;
    smoothBed('windLow', beds.windLow.gain, 0.095 * (BEDS.wind || 0.5) * windBase, step, tc, immediate);
    smoothBed('windMid', beds.windMid.gain, 0.035 * (BEDS.wind || 0.5) * windBase, step, tc, immediate);
    smoothBed('leaves', beds.leaves.gain, 0.022 * (BEDS.leaves || 0.32) * (0.25 + 0.75 * w) * gust * gust * natureBoost * portalDuck, step, tc, immediate);
    const flow = 0.9 + 0.1 * Math.sin(waterPhase) + 0.05 * Math.sin(waterPhase * 2.3 + 1.1);
    const pondFlow = 0.92 + 0.08 * Math.sin(waterPhase * 0.6 + 2.2);
    smoothBed('river', beds.river.gain, 0.12 * (BEDS.river || 0.55) * region.river * flow * natureBoost * portalDuck, step, tc, immediate);
    smoothBed('riverHigh', beds.riverHigh.gain, 0.022 * region.river * (0.75 + 0.25 * Math.sin(waterPhase * 1.7 + 0.4)) * natureBoost * portalDuck, step, tc, immediate);
    smoothBed('pond', beds.pond.gain, 0.05 * (BEDS.pond || 0.34) * region.pond * pondFlow * natureBoost * portalDuck, step, tc, immediate);
    smoothBed('cave', beds.cave.gain, 0.09 * (BEDS.cave || 0.5) * Math.max(region.cave, portalOcc * 0.95), step, tc, immediate);
    smoothBed('village', beds.village.gain, 0.055 * (BEDS.village || 0.32) * region.village * clutterScale * portalDuck, step, tc, immediate);
    smoothBed('villageHigh', beds.villageHigh.gain, 0.016 * (BEDS.village || 0.32) * region.village * clutterScale * portalDuck, step, tc, immediate);
    const rain = clamp(ambience.rain, 0, 1);
    const sh = clamp(Math.max(syncState.shelter, syncState.skiffCanopy), 0, 1);
    smoothBed('rain', beds.rain.gain, 0.1 * (BEDS.rain || 0.52) * rain * (1 - 0.38 * sh) * portalDuck, step, tc, immediate);
    smoothBed('rainLow', beds.rainLow.gain, 0.04 * rain * (1 + 0.36 * sh) * portalDuck, step, tc, immediate);
    smoothBed('rainHigh', beds.rainHigh.gain, 0.018 * rain * (1 - 0.76 * sh) * portalDuck, step, tc, immediate);
    if (beds.rain.filter) beds.rain.filter.frequency.value = (6000 - 3700 * sh) * (1 - 0.65 * portalOcc);
    if (beds.river.filter) beds.river.filter.frequency.value = 380 + (1450 - 380) * (1 - 0.85 * portalOcc) * (0.35 + 0.65 * bloomOpen);
    if (beds.village.filter) beds.village.filter.frequency.value = 280 + (500 - 280) * (1 - 0.75 * portalOcc) * (0.45 + 0.55 * bloomOpen);

    // 北涧飞泉与东皋松涛连续底景：随距离、雨势、静听加成与听者朝向立体声平移
    const rainFlow = 1 + 0.28 * rain;
    const cascLevel = Math.max(region.cascade, region.brook * 0.44);
    const pineGust = (0.42 + 0.58 * w) * (0.72 + 0.28 * Math.sin(windPhase * 0.85 + 0.9));
    smoothBed('cascade', beds.cascade.gain, 0.135 * (BEDS.river || 0.55) * cascLevel * flow * rainFlow * natureBoost * (1 - 0.5 * region.cave), step, tc, immediate);
    smoothBed('cascadeHigh', beds.cascadeHigh.gain, 0.028 * (region.cascade * 0.88 + region.brook * 0.36) * (0.78 + 0.22 * Math.sin(waterPhase * 1.9 + 0.8)) * rainFlow * natureBoost * (1 - 0.6 * region.cave), step, tc, immediate);
    smoothBed('pineWind', beds.pineWind.gain, 0.054 * (BEDS.wind || 0.5) * region.pineRidge * pineGust * natureBoost * (1 - 0.8 * region.cave), step, tc, immediate);

    // Slow organic LFO filter breathing for wind, foliage, and stream shimmer
    if (beds.windMid && beds.windMid.filter) {
      beds.windMid.filter.frequency.value = 620 + 135 * Math.sin(e * 0.37) + 55 * Math.sin(e * 0.83 + 1.1);
    }
    if (beds.leaves && beds.leaves.filter) {
      const snowHush = 1 - 0.42 * clamp(syncState.snow || 0, 0, 1);
      const leafOpen = (1 - 0.88 * portalOcc) * (0.25 + 0.75 * bloomOpen) * snowHush;
      beds.leaves.filter.frequency.value = 460 + ((8600 + 420 * qf) + 1150 * Math.sin(e * 0.29 + 0.7) + 480 * Math.sin(e * 0.71 + 2.3) - 460) * leafOpen;
    }
    if (beds.riverHigh && beds.riverHigh.filter) {
      beds.riverHigh.filter.frequency.value = (2350 + 220 * qf) + 340 * Math.sin(e * 0.43 + 1.4) + 160 * Math.sin(e * 1.07 + 0.3);
    }
    if (beds.pond && beds.pond.filter) {
      beds.pond.filter.frequency.value = 720 + 95 * Math.sin(e * 0.23 + 1.9);
    }
    if (beds.cascadeHigh && beds.cascadeHigh.filter) {
      beds.cascadeHigh.filter.frequency.value = (2880 + 220 * qf) + 310 * Math.sin(e * 0.51 + 0.9);
    }
    if (beds.pineWind && beds.pineWind.filter) {
      beds.pineWind.filter.frequency.value = (495 + 55 * qf) + 110 * Math.sin(e * 0.31 + 1.6) + 42 * Math.sin(e * 0.77 + 0.4);
    }
    smoothBed('night', beds.night.gain, 0.03 * (BEDS.night || 0.34) * clamp(ambience.night, 0, 1) * (1 - region.cave * 0.6), step, tc, immediate);
    smoothBed('caveSend', caveSend.gain, 0.05 + Math.max(region.cave * 0.65, portalOcc * 0.74), step, tc, immediate);
    if (sampleCaveSend) {
      smoothBed('sampleCaveSend', sampleCaveSend.gain, Math.max(region.cave * 0.58, portalOcc * 0.65), step, tc, immediate);
    }
    if (beds.windLow.pan) beds.windLow.pan.value = Math.sin(windPhase * 0.62) * 0.18;
    if (beds.leaves.pan) beds.leaves.pan.value = Math.sin(windPhase * 1.13 + 1.7) * 0.45;
    if (beds.river.pan) beds.river.pan.value = Math.sin(waterPhase * 0.23) * 0.1;
    if (beds.pond.pan) beds.pond.pan.value = Math.sin(waterPhase * 0.31 + 1.2) * 0.16;
    const cascPan = region.cascade >= region.brook * 0.5
      ? panFor(borderlandAnchors.cascade.x, borderlandAnchors.cascade.z)
      : panFor(lastBrookPt.x, lastBrookPt.z);
    if (beds.cascade.pan) beds.cascade.pan.value = cascPan;
    if (beds.cascadeHigh.pan) beds.cascadeHigh.pan.value = cascPan * 0.9;
    if (beds.pineWind.pan) beds.pineWind.pan.value = panFor(activePineAnchor.x, activePineAnchor.z) * 0.78;
  }

  function setQuietFocus(active) {
    syncState.quietExplicit = Boolean(active);
    if (syncState.quietExplicit && syncState.quietBlend < 0.35) syncState.quietBlend = 0.35;
    if (ready && beds) applyBeds(false, 0.05, lfoClock);
    return syncState.quietExplicit;
  }

  function eventPosition(r) {
    const a = Math.random() * TAU;
    const d = rand(r * 0.35, r);
    return { x: listener.x + Math.cos(a) * d, z: listener.z + Math.sin(a) * d };
  }

  function updateEvents(dt) {
    if (!canRunProcedural()) {
      for (const k in timers) {
        timers[k] -= dt;
        if (timers[k] <= 0) timers[k] = 1.2;
      }
      return;
    }
    for (const k in timers) timers[k] -= dt;
    const night = clamp(ambience.night, 0, 1);
    const day = 1 - night;
    const inCave = region.cave > 0.3;
    const phen = syncState.phenology || 'spring';

    if (timers.drip <= 0) {
      timers.drip = rand((SC.water && SC.water.caveDripGap || [2.4, 6.8])[0], (SC.water && SC.water.caveDripGap || [2.4, 6.8])[1]);
      if (region.cave > 0.08 && cavePos) {
        const a = Math.random() * TAU;
        const inTunnel = isInCavePassage(listener.x, listener.z);
        const cx = inTunnel ? listener.x : cavePos.x;
        const cz = inTunnel ? listener.z : cavePos.z;
        const d = inTunnel ? rand(2.2, 8.5) : rand(5, 17);
        drip(cx + Math.cos(a) * d, cz + Math.sin(a) * d, region.cave);
      }
    }
    if (timers.clatter <= 0) {
      timers.clatter = rand((SC.village && SC.village.clatterGap || [1.8, 5.6])[0], (SC.village && SC.village.clatterGap || [1.8, 5.6])[1]);
      if (region.village > 0.2 && houses.length) {
        const h = houses[(Math.random() * houses.length) | 0];
        clatter(h.x + rand(-3, 3), h.z + rand(-3, 3));
      }
    }
    if (timers.chatter <= 0) {
      timers.chatter = rand((SC.village && SC.village.chatterGap || [7, 18])[0], (SC.village && SC.village.chatterGap || [7, 18])[1]);
      if (region.village > 0.3 && deps.people && deps.people.list && deps.people.list.length) {
        const list = deps.people.list;
        for (let tries = 0; tries < 8; tries++) {
          const p = list[(Math.random() * list.length) | 0];
          // 背景交谈来自正在交谈的人，而不是正在干活或独自赶路的人。
          if (p && (p.speaking === undefined ? p.mode === 'talk' : p.speaking && p.activity === 'talk') && p.greetT <= 0 && Math.hypot(p.x - listener.x, p.z - listener.z) < 26) {
            voice(p.role, p.x, p.z, { chatter: true, laugh: Math.random() < 0.16, emitterId: 'person:' + list.indexOf(p), gain: 0.75 * region.village });
            break;
          }
        }
      }
    }
    if (timers.bird <= 0) {
      timers.bird = rand(2.6, 7.2);
      if (day > 0.05) {
        const q = eventPosition(32);
        bird(q.x, q.z, day * (1 - region.cave) * (1 - 0.45 * region.village) * (1 - 0.55 * clamp(ambience.rain, 0, 1))); 
      }
    }
    if (timers.cricket <= 0) {
      const autumnClear = phen === 'autumn' && !inCave && ambience.rain < 0.55;
      timers.cricket = (autumnClear && night <= 0.22) ? rand(0.95, 2.0) : rand(0.38, 1.2);
      if ((night > 0.22 || autumnClear) && !inCave) {
        const q = eventPosition(24);
        cricket(q.x, q.z, (autumnClear && night <= 0.22) ? 0.76 : 1.0);
      }
    }
    if (timers.drop <= 0) {
      timers.drop = rand(0.07, 0.2);
      if (ambience.rain > 0.12 && !inCave) {
        const q = eventPosition(18);
        rainDrop(q.x, q.z);
      }
    }
    if (timers.gurgle <= 0) {
      timers.gurgle = rand(1.7, 4.4);
      if (region.river > 0.3) {
        const q = nearestSpine(listener.x, listener.z);
        if (q) gurgle(q.x + rand(-2, 2), q.z + rand(-2, 2));
      }
    }
    if (timers.frog <= 0) {
      const summerLotus = phen === 'summer' && !inCave && ambience.rain < 0.55;
      timers.frog = rand(2.4, 6.2) * (summerLotus ? 0.7 : 1.0);
      if (region.pond > 0.18 && (night > 0.15 || summerLotus) && ambience.rain < 0.55 && syncState.frogHush <= 0 && !inCave) {
        const q = eventPosition(20);
        frog(q.x, q.z);
      }
    }
    if (timers.gust <= 0) {
      const autumnBreeze = phen === 'autumn' && !inCave && ambience.rain < 0.55;
      timers.gust = rand(0.9, 2.8) * (autumnBreeze ? 0.85 : 1.0);
      if (ambience.wind > (autumnBreeze ? 0.12 : 0.18)) {
        const q = eventPosition(26);
        leafRustle(q.x, q.z);
      }
    }
    if (timers.dog <= 0) {
      timers.dog = rand(20, 44);
      if (night > 0.35 && !inCave) {
        const q = eventPosition(48);
        dogFar(q.x, q.z);
      }
    }
    if (timers.cascadeSplash <= 0) {
      timers.cascadeSplash = rand(1.6, 3.6);
      if ((region.cascade > 0.22 || region.brook > 0.32) && !inCave) {
        const usePool = region.cascade >= region.brook * 0.6;
        const sx = (usePool ? borderlandAnchors.cascade.x : lastBrookPt.x) + rand(-1.8, 1.8);
        const sz = (usePool ? borderlandAnchors.cascade.z : lastBrookPt.z) + rand(-1.8, 1.8);
        cascadeSplash(sx, sz);
      }
    }
    if (timers.crane <= 0) {
      timers.crane = rand(13.5, 25.0);
      if (day > 0.28 && ambience.rain < 0.35 && !inCave && (listener.z < -158 || listener.x > 82)) {
        craneCall(24.5 + rand(-14, 14), -239.5 + rand(-10, 10));
      }
    }
    if (timers.goat <= 0) {
      timers.goat = rand(11.0, 21.0);
      if (day > 0.30 && ambience.rain < 0.35 && !inCave) {
        const dp = Math.hypot(listener.x - borderlandAnchors.eastPasture.x, listener.z - borderlandAnchors.eastPasture.z);
        if (dp < 38) {
          goatBleat(borderlandAnchors.eastPasture.x + rand(-4, 4), borderlandAnchors.eastPasture.z + rand(-4, 4));
        }
      }
    }
    if (timers.teaSimmer <= 0) {
      timers.teaSimmer = rand(2.2, 3.8);
      if (!inCave) {
        const dtStove = Math.hypot(listener.x - borderlandAnchors.teaStove.x, listener.z - borderlandAnchors.teaStove.z);
        const dtMtnTea = Math.hypot(listener.x - borderlandAnchors.mountainTea.x, listener.z - borderlandAnchors.mountainTea.z);
        const dtDeepTea = Math.hypot(listener.x - deepHollowAnchors.teaStove.x, listener.z - deepHollowAnchors.teaStove.z);
        if (dtStove < 14.5) {
          teaSimmer(borderlandAnchors.teaStove.x, borderlandAnchors.teaStove.z);
        } else if (dtMtnTea < 15.0) {
          teaSimmer(borderlandAnchors.mountainTea.x, borderlandAnchors.mountainTea.z);
        } else {
          const isDeepNight = night >= 0.72;
          const isDuskOrNight = night > 0.35;
          const deepTeaMax = isDeepNight ? 26.0 : (isDuskOrNight ? 22.0 : 20.0);
          if (dtDeepTea < deepTeaMax) {
            const distAtten = 1 - smoothstep(3.0, deepTeaMax, dtDeepTea);
            const timeScale = isDeepNight ? 0.66 : (isDuskOrNight ? 0.92 : 1.05);
            tmpTeaOpts.gainScale = clamp(distAtten * timeScale, 0.22, 1.4);
            tmpTeaOpts.withEmberCrackle = true;
            teaSimmer(deepHollowAnchors.teaStove.x, deepHollowAnchors.teaStove.z, tmpTeaOpts);
            if (isDeepNight) timers.teaSimmer = rand(3.2, 5.2);
          }
        }
      }
    }
    if (timers.coldSpring <= 0) {
      const isNightQuiet = night > 0.35;
      timers.coldSpring = isNightQuiet ? rand(1.35, 2.55) : rand(1.6, 3.0);
      if (!inCave) {
        const springMaxDist = isNightQuiet ? 34.0 : 26.0;
        const dSpring = Math.hypot(listener.x - deepHollowAnchors.coldSpring.x, listener.z - deepHollowAnchors.coldSpring.z);
        if (dSpring < springMaxDist) {
          const distAtten = 1 - smoothstep(4.0, springMaxDist, dSpring);
          const rainBoost = 1 + 0.22 * clamp(ambience.rain, 0, 1);
          const nightClarity = isNightQuiet ? 1.18 : 1.0;
          tmpSpringOpts.gainScale = clamp(distAtten * rainBoost * nightClarity, 0.22, 1.45);
          bambooSpring(deepHollowAnchors.coldSpring.x, deepHollowAnchors.coldSpring.z, tmpSpringOpts);
        }
      }
    }
    if (timers.goStone <= 0) {
      timers.goStone = rand(5.2, 9.8);
      if (day > 0.25 && !inCave) {
        const dtLanke = Math.hypot(listener.x - borderlandAnchors.lanke.x, listener.z - borderlandAnchors.lanke.z);
        if (dtLanke < 24.0) {
          goStoneClick(borderlandAnchors.lanke.x, borderlandAnchors.lanke.z);
        }
      }
    }
    if (timers.kilnCrackle <= 0) {
      timers.kilnCrackle = rand(2.0, 4.2);
      if (!inCave) {
        const dtKiln = Math.hypot(listener.x - borderlandAnchors.kiln.x, listener.z - borderlandAnchors.kiln.z);
        if (dtKiln < 21.0) {
          kilnCrackle(borderlandAnchors.kiln.x, borderlandAnchors.kiln.z);
        }
      }
    }
    if (timers.poeticMusic <= 0) {
      // 八分留白：每次 2–3 音后静待 26–48 秒，绝不打扰自然天籁
      timers.poeticMusic = rand(26, 48);
      if (!inCave) {
        triggerPoeticPhrase();
      }
    }
    if (phen === 'summer' && !inCave && ambience.rain < 0.55) {
      const isDayOrDusk = syncState.timeId
        ? (syncState.timeId === 'day' || syncState.timeId === 'dusk')
        : day > 0.32;
      if (isDayOrDusk) {
        syncState.cicadaTimer -= dt;
        if (syncState.cicadaTimer <= 0) {
          syncState.cicadaTimer = rand(3.2, 6.8);
          const q = eventPosition(30);
          cicadaShimmer(q.x, q.z);
        }
      }
    }
  }

  function update(dt, elapsed, camera, playerState, frozen) {
    if (!ctx) return;
    lastFrozen = Boolean(frozen);
    dt = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.05);
    if (master) master.gain.value = effectiveMasterGain();
    const mutedNow = Boolean(frozen || userMuted || userVolume <= 0.001 || (master && master.gain.value <= 0));
    samples.setMuted(mutedNow);
    if (mutedNow) stopActiveCrows();
    if (frozen || dt === 0) {
      // Main calls this branch before its pause/hidden/map early return.
      // Freeze clocks/events too: no background one-shots or catch-up footsteps on resume.
      if (frozen) { lastX = null; lastZ = null; stepDist = 0; }
      return;
    }
    lfoClock = Number.isFinite(elapsed) ? elapsed : (lfoClock + dt);
    windPhase += dt * (SC.wind && SC.wind.speed || 0.11);
    waterPhase += dt * 0.37;

    syncState.quietStill = Boolean(playerState && playerState.still && !playerState.aboardSkiff);
    const wantQuiet = (syncState.quietExplicit || syncState.quietSync || syncState.quietStill) ? 1 : 0;
    syncState.quietBlend += (wantQuiet - syncState.quietBlend) * Math.min(1, dt * 2.5);

    let px = listener.x, pz = listener.z, py = listener.y;
    if (camera && camera.position) {
      px = camera.position.x; py = camera.position.y; pz = camera.position.z;
      listener.yaw = camera.rotation ? camera.rotation.y : 0;
      hasListener = true;
    } else if (playerState) {
      px = playerState.x; py = playerState.y; pz = playerState.z;
      listener.yaw = playerState.yaw || 0;
      hasListener = true;
    }
    listener.x = px; listener.z = pz; listener.y = py;
    samples.setListener(listener);
    updateRegion(px, pz, dt);
    applyBeds(false, dt, lfoClock);

    if (playerState && !frozen) {
      const airborne = Boolean(playerState.airborne);
      if (playerState.aboardSkiff || playerState.godFlight) {
        stepDist = 0;
        wasAirborne = false;
      } else {
        if (playerState.justJumped || (airborne && !wasAirborne && (playerState.vy || 0) > 1.2)) {
          stepDist = 0;
          const surf = playerState.wading
            ? 'water'
            : (playerState.onWood ? 'wood' : stepSurface(playerState.x, playerState.z));
          footstep(surf, false);
        } else if (playerState.justLanded || (!airborne && wasAirborne)) {
          stepDist = 0;
          const surf = playerState.wading
            ? 'water'
            : (playerState.onWood ? 'wood' : stepSurface(playerState.x, playerState.z));
          footstep(surf, true);
        }
        if (airborne) {
          stepDist = 0;
        } else if (lastX !== null) {
          const dx = playerState.x - lastX;
          const dz = playerState.z - lastZ;
          const moved = Math.hypot(dx, dz);
          const speed = moved / Math.max(0.001, dt);
          if (moved > 3) {
            stepDist = 0;
          } else if (speed > 0.3) {
            stepDist += moved;
            const running = speed > 5.6;
            const stride = running
              ? (SC.footsteps && SC.footsteps.runStride || 2.0)
              : (SC.footsteps && SC.footsteps.stride || 1.35);
            if (stepDist >= stride) {
              stepDist -= stride;
              const surf = playerState.wading
                ? 'water'
                : (playerState.onWood ? 'wood' : stepSurface(playerState.x, playerState.z));
              footstep(surf, running);
            }
          } else {
            stepDist = 0;
          }
        }
        wasAirborne = airborne;
      }
      lastX = playerState.x;
      lastZ = playerState.z;
    }

    if (ready && !frozen) updateEvents(dt);
  }

  function setAmbience(next) {
    if (!next) return;
    if (next.rain !== undefined) ambience.rain = clamp(next.rain, 0, 1);
    if (next.wind !== undefined) ambience.wind = clamp(next.wind, 0, 1);
    if (next.night !== undefined) ambience.night = clamp(next.night, 0, 1);
    if (ready) applyBeds(false, 0.05, lfoClock);
  }

  function getLevels() {
    const out = { rms: 0, peak: 0, db: -100, low: 0, mid: 0, high: 0, state: ctx ? ctx.state : 'none' };
    if (!analyser || !ctx) return out;
    const time = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(time);
    let sum = 0, peak = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    out.rms = Math.sqrt(sum / time.length);
    out.peak = peak;
    out.db = out.rms > 0.000001 ? 20 * Math.log10(out.rms) : -100;

    const freq = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freq);
    const binHz = ctx.sampleRate / analyser.fftSize;
    function band(a, b) {
      const i0 = Math.max(0, Math.floor(a / binHz));
      const i1 = Math.min(freq.length - 1, Math.ceil(b / binHz));
      let s = 0, n = 0;
      for (let i = i0; i <= i1; i++) { const v = freq[i] / 255; s += v * v; n++; }
      return n ? Math.sqrt(s / n) : 0;
    }
    out.low = band(30, 250);
    out.mid = band(250, 2500);
    out.high = band(2500, 12000);
    lastLevel = out.rms;
    return out;
  }

  function syncWorld(dt, sync) {
    if (!ctx || !ready || !sync) return;
    if (sync.phenology !== undefined) {
      const nextPhen = sync.phenology || 'spring';
      if (nextPhen !== syncState.phenology && nextPhen === 'summer') {
        timers.frog = Math.min(timers.frog, rand(1.4, 2.8));
      }
      syncState.phenology = nextPhen;
    }
    if (typeof sync.timeId === 'string') {
      syncState.timeId = sync.timeId;
    }
    if (sync.snow !== undefined) {
      syncState.snow = clamp(Number(sync.snow) || 0, 0, 1);
    }
    if (sync.borderlands) {
      syncBorderlandLayout(sync.borderlands);
    }
    if (sync.deepHollows) {
      syncDeepHollowsLayout(sync.deepHollows);
    }
    if (!Number.isFinite(dt) || dt <= 0 || !canPlayProcedural()) return;
    const step = clamp(dt, 0, 0.1);
    const rain = Number(sync.rain ?? ambience.rain) || 0;
    const isNight = Boolean(sync.isNight);

    if (sync.quiet !== undefined || sync.quietFocus !== undefined) {
      syncState.quietSync = Boolean(sync.quiet ?? sync.quietFocus);
      const wantQuiet = (syncState.quietExplicit || syncState.quietSync || syncState.quietStill) ? 1 : 0;
      syncState.quietBlend += (wantQuiet - syncState.quietBlend) * Math.min(1, step * 3.0);
    }

    const wasFrogHushed = syncState.frogHush > 0.05;
    if (syncState.frogHush > 0) syncState.frogHush = Math.max(0, syncState.frogHush - step);
    if (syncState.frogPlopCooldown > 0) syncState.frogPlopCooldown = Math.max(0, syncState.frogPlopCooldown - step);
    let handledFrogPlopEvent = false;

    if (Array.isArray(sync.events)) {
      for (let i = 0; i < sync.events.length; i++) {
        const ev = sync.events[i];
        if (!ev) continue;
        if (ev.type === 'gateCreak') gateCreak(ev.x, ev.z);
        else if (ev.type === 'roosterFlap') roosterFlap(ev.x, ev.z);
        else if (ev.type === 'roosterCrow') roosterCrow(ev.x, ev.z);
        else if (ev.type === 'roosterCrowEcho') roosterCrow(ev.x, ev.z, { echo: true });
        else if (ev.type === 'boatPole') boatPole(ev.x, ev.z, ev.intensity);
        else if (ev.type === 'poleDrip') poleDrip(ev.x, ev.z, ev.intensity);
        else if (ev.type === 'loom' || ev.type === 'loomClack') loomClack(ev.x, ev.z);
        else if (ev.type === 'mortar' || ev.type === 'mortarThud') mortarThud(ev.x, ev.z);
        else if (ev.type === 'waterCup') waterCup(ev.x, ev.z);
        else if (ev.type === 'toastCup' || ev.type === 'toast') toastCup(ev.x, ev.z);
        else if (ev.type === 'stagCall') stagCall(ev.x, ev.z);
        else if (ev.type === 'stoolSit') stoolSit(ev.x, ev.z);
        else if (ev.type === 'frogPlop') {
          handledFrogPlopEvent = true;
          syncState.frogHush = Math.max(syncState.frogHush, 3.5);
          syncState.frogPlopCooldown = 5.2;
          frogPlop(ev.x, ev.z);
        }
        else if (ev.type === 'dewDrop') dewDrop(ev.x, ev.z);
        else if (ev.type === 'cascadeSplash') cascadeSplash(ev.x, ev.z);
        else if (ev.type === 'craneCall') craneCall(ev.x, ev.z);
        else if (ev.type === 'goatBleat') goatBleat(ev.x, ev.z);
        else if (ev.type === 'plowScrape') plowScrape(ev.x, ev.z, ev);
        else if (ev.type === 'oxLow') oxLow(ev.x, ev.z);
        else if (ev.type === 'teaSimmer') teaSimmer(ev.x, ev.z);
        else if (ev.type === 'bambooSpring') bambooSpring(ev.x, ev.z);
        else if (ev.type === 'stoneSkip') stoneSkip(ev.x, ev.z, ev.hop ?? 0);
        else if (ev.type === 'canopyRain') canopyRain(ev.x, ev.z, ev.intensity ?? rain);
        else if (ev.type === 'goStoneClick') goStoneClick(ev.x, ev.z);
        else if (ev.type === 'kilnCrackle') kilnCrackle(ev.x, ev.z);
        else if (ev.type === 'raftKnock') raftKnock(ev.x, ev.z, ev.intensity);
        else if (ev.type === 'netRustle') netRustle(ev.x, ev.z, ev.intensity);
        else if (ev.type === 'laundry' || ev.type === 'laundryPound') laundryPound(ev.x, ev.z, ev.strokes || 2);
        else if (ev.type === 'henStartle' && Math.hypot((ev.x || 0) - listener.x, (ev.z || 0) - listener.z) < 26) {
          cluck(ev.x, ev.z);
        }
      }
    }

    if (sync.sprinting && region.pond > 0.2) {
      syncState.frogHush = 3.5;
      if (!wasFrogHushed && !handledFrogPlopEvent && !sync.frogVisualManaged && syncState.frogPlopCooldown <= 0 && pond) {
        const ang = Math.atan2(listener.z - pond.z, listener.x - pond.x);
        const rim = deps.village?.pond?.rim;
        let rimR = pond.waterRadius || (pond.radius || 12) * 0.7;
        if (Array.isArray(rim) && rim.length >= 3) {
          const normA = ((ang % TAU) + TAU) % TAU;
          const idx = Math.floor((normA / TAU) * rim.length) % rim.length;
          rimR = rim[idx] || rimR;
        }
        const waterR = Math.max(1.2, rimR - 0.55);
        frogPlop(pond.x + Math.cos(ang) * waterR, pond.z + Math.sin(ang) * waterR);
        syncState.frogPlopCooldown = 5.2;
      }
    }

    // Shelter acoustic muffling & eave rain drips under thatched pavilion / eaves
    let activeShelter = null;
    let targetShelter = 0;
    if (Array.isArray(sync.shelters)) {
      for (let i = 0; i < sync.shelters.length; i++) {
        const s = sync.shelters[i];
        if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
        const dx = listener.x - s.x;
        const dz = listener.z - s.z;
        const c = Math.cos(s.rot || 0);
        const sn = Math.sin(s.rot || 0);
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) <= (s.rx || 1.5) && Math.abs(lz) <= (s.rz || 1.5) &&
            (!Number.isFinite(s.roofY) || listener.y <= s.roofY + 0.5)) {
          const factor = s.kind === 'eave' ? 0.72 : 1.0;
          if (factor > targetShelter) {
            targetShelter = factor;
            activeShelter = s;
          }
        }
      }
    }
    const targetSkiffCanopy = sync.aboardSkiff ? 0.58 : 0;
    syncState.skiffCanopy += (targetSkiffCanopy - syncState.skiffCanopy) * Math.min(1, step * 5);
    const prevShelter = syncState.shelter;
    syncState.shelter += (targetShelter - syncState.shelter) * Math.min(1, step * 6);
    if (Math.abs(targetShelter - prevShelter) > 0.002 && ready && beds) {
      applyBeds(false, step, lfoClock);
    }
    if (syncState.shelter > 0.25 && rain > 0.08 && activeShelter) {
      syncState.eaveDripTimer -= step;
      if (syncState.eaveDripTimer <= 0) {
        syncState.eaveDripTimer = 0.16 + (1 - clamp(rain, 0, 1)) * 0.28 + Math.random() * 0.14;
        const side = Math.floor(Math.random() * 4);
        const rx = activeShelter.rx || 2;
        const rz = activeShelter.rz || 2;
        let lx = (Math.random() * 2 - 1) * rx;
        let lz = (Math.random() * 2 - 1) * rz;
        if (side === 0) lz = rz;
        else if (side === 1) lz = -rz;
        else if (side === 2) lx = rx;
        else lx = -rx;
        const c = Math.cos(activeShelter.rot || 0);
        const sn = Math.sin(activeShelter.rot || 0);
        drip(activeShelter.x + lx * c + lz * sn, activeShelter.z - lx * sn + lz * c, 0.52 + 0.35 * rain);
        worldSync.eaveDrips++;
      }
    }

    // Clear-night threshing-floor bonfire clay-fou & pentatonic xun accompaniment
    if (sync.nightFeast?.active && isNight && rain < 0.25) {
      const df = Math.hypot(sync.nightFeast.x - listener.x, sync.nightFeast.z - listener.z);
      if (df < 34) {
        syncState.fouTimer -= step;
        if (syncState.fouTimer <= 0) {
          syncState.fouTimer = 0.85;
          fouBeat(sync.nightFeast.x, sync.nightFeast.z, syncState.fouStep++);
        }
      }
    }

    if (sync.washStation && !sync.communityWashActive && !isNight && rain < 0.25) {
      const dWash = Math.hypot(sync.washStation.x - listener.x, sync.washStation.z - listener.z);
      if (dWash < 34) {
        syncState.laundryTimer -= step;
        if (syncState.laundryTimer <= 0) {
          syncState.laundryTimer = 3.2;
          laundryPound(sync.washStation.x, sync.washStation.z, 3);
        }
      }
    }

    if (sync.wheel && Number.isFinite(sync.wheel.phase)) {
      const halfTurn = Math.floor(sync.wheel.phase / Math.PI);
      if (syncState.lastWheelHalf !== null && halfTurn !== syncState.lastWheelHalf) {
        const dWheel = Math.hypot(sync.wheel.x - listener.x, sync.wheel.z - listener.z);
        if (dWheel < 36) wheelCreak(sync.wheel.x, sync.wheel.z, 0.72);
      }
      syncState.lastWheelHalf = halfTurn;
    }
  }

  function getStats() {
    const wsOut = {
      laundryPounds: worldSync.laundryPounds,
      wheelCreaks: worldSync.wheelCreaks,
      gateCreaks: worldSync.gateCreaks,
      roosterCrows: worldSync.roosterCrows,
      gathers: worldSync.gathers
    };
    Object.defineProperties(wsOut, {
      roosterFlaps: { value: worldSync.roosterFlaps, enumerable: false },
      frogPlops: { value: worldSync.frogPlops, enumerable: false },
      dewDrops: { value: worldSync.dewDrops, enumerable: false },
      eaveDrips: { value: worldSync.eaveDrips, enumerable: false },
      boatPoles: { value: worldSync.boatPoles, enumerable: false },
      poleDrips: { value: worldSync.poleDrips, enumerable: false },
      fouBeats: { value: worldSync.fouBeats, enumerable: false },
      cicadas: { value: worldSync.cicadas, enumerable: false },
      waterCups: { value: worldSync.waterCups, enumerable: false },
      toasts: { value: worldSync.toasts, enumerable: false },
      stagCalls: { value: worldSync.stagCalls, enumerable: false },
      loomClacks: { value: worldSync.loomClacks, enumerable: false },
      mortarThuds: { value: worldSync.mortarThuds, enumerable: false },
      stoolSits: { value: worldSync.stoolSits, enumerable: false },
      cascadeSplashes: { value: worldSync.cascadeSplashes, enumerable: false },
      craneCalls: { value: worldSync.craneCalls, enumerable: false },
      goatBleats: { value: worldSync.goatBleats, enumerable: false },
      teaSimmers: { value: worldSync.teaSimmers, enumerable: false },
      plowScrapes: { value: worldSync.plowScrapes, enumerable: false },
      oxLows: { value: worldSync.oxLows, enumerable: false },
      raftKnocks: { value: worldSync.raftKnocks, enumerable: false },
      netRustles: { value: worldSync.netRustles, enumerable: false },
      snowSteps: { value: worldSync.snowSteps, enumerable: false },
      springDrips: { value: worldSync.springDrips, enumerable: false }
    });
    return {
      ready: ready,
      context: ctx ? ctx.state : 'none',
      sampleRate: ctx ? ctx.sampleRate : 0,
      master: master ? master.gain.value : 0,
      muted: Boolean(userMuted || userVolume <= 0.001),
      audioMode: userMode,
      ambience: { rain: ambience.rain, wind: ambience.wind, night: ambience.night },
      region: {
        river: region.river,
        pond: region.pond,
        cave: region.cave,
        village: region.village,
        cascade: region.cascade,
        brook: region.brook,
        pineRidge: region.pineRidge
      },
      counts: {
        voices: stats.voices, clucks: stats.clucks, barks: stats.barks,
        chirps: stats.chirps, lows: stats.lows, quacks: stats.quacks,
        steps: stats.steps, drips: stats.drips,
        clatters: stats.clatters, drops: stats.drops,
        gurgles: stats.gurgles, frogs: stats.frogs, rustles: stats.rustles
      },
      footstepMaterials: {
        grass: stepMaterials.grass,
        dirt: stepMaterials.dirt,
        stone: stepMaterials.stone,
        wood: stepMaterials.wood,
        water: stepMaterials.water,
        snow: stepMaterials.snow
      },
      worldSync: wsOut,
      completionSync: {
        roosterFlaps: worldSync.roosterFlaps,
        frogPlops: worldSync.frogPlops,
        dewDrops: worldSync.dewDrops,
        frogHushed: syncState.frogHush > 0,
        eaveDrips: worldSync.eaveDrips,
        boatPoles: worldSync.boatPoles,
        poleDrips: worldSync.poleDrips,
        fouBeats: worldSync.fouBeats,
        cicadas: worldSync.cicadas,
        waterCups: worldSync.waterCups,
        toasts: worldSync.toasts,
        stagCalls: worldSync.stagCalls,
        loomClacks: worldSync.loomClacks,
        mortarThuds: worldSync.mortarThuds,
        stoolSits: worldSync.stoolSits,
        cascadeSplashes: worldSync.cascadeSplashes,
        craneCalls: worldSync.craneCalls,
        goatBleats: worldSync.goatBleats,
        teaSimmers: worldSync.teaSimmers,
        plowScrapes: worldSync.plowScrapes,
        oxLows: worldSync.oxLows,
        stoneSkips: worldSync.stoneSkips,
        canopyRains: worldSync.canopyRains,
        goStoneClicks: worldSync.goStoneClicks,
        kilnCrackles: worldSync.kilnCrackles,
        portalBlooms: worldSync.portalBlooms,
        raftKnocks: worldSync.raftKnocks,
        netRustles: worldSync.netRustles,
        snowSteps: worldSync.snowSteps,
        springDrips: worldSync.springDrips,
        tunnelOcclusion: Math.round(syncState.tunnelOcclusion * 1000) / 1000,
        portalBloom: Math.round(syncState.portalBloom * 1000) / 1000,
        phenology: syncState.phenology,
        quietFocus: Math.round(syncState.quietBlend * 1000) / 1000,
        shelter: Math.round(syncState.shelter * 1000) / 1000
      },
      beds: ready && beds ? {
        rainCutoffHz: beds.rain.filter ? beds.rain.filter.frequency.value : 0,
        rainGain: beds.rain.gain.value,
        rainLowGain: beds.rainLow.gain.value,
        rainHighGain: beds.rainHigh.gain.value,
        cascadeGain: beds.cascade.gain.value,
        cascadeHighGain: beds.cascadeHigh.gain.value,
        pineWindGain: beds.pineWind.gain.value,
        cascadePan: beds.cascade.pan ? beds.cascade.pan.value : 0,
        pineWindPan: beds.pineWind.pan ? beds.pineWind.pan.value : 0
      } : null,
      level: lastLevel,
      poeticMusic: {
        phrases: poeticMusic.phrases,
        valleyEmergences: poeticMusic.valleyEmergences,
        lastInstrument: poeticMusic.lastInstrument,
        lostMood: poeticMusic.lostMood
      },
      samples: samples.getStats(),
      places: {
        village: villageCenter, cave: cavePos,
        pond: pond ? { x: pond.x, z: pond.z, r: pond.waterRadius || pond.radius } : null
      }
    };
  }

  // 调试时可以把当前声场录成 blob；正常游玩不会用到
  function debugRecord(seconds) {
    return new Promise(function (resolve) {
      if (!ctx || !window.MediaRecorder) return resolve(null);
      const dest = ctx.createMediaStreamDestination();
      master.connect(dest);
      const rec = new MediaRecorder(dest.stream);
      const chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        try { master.disconnect(dest); } catch (e) {}
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start();
      setTimeout(function () { try { rec.stop(); } catch (e) {} }, Math.max(0.5, seconds || 3) * 1000);
    });
  }

  return {
    unlock: unlock,
    update: update,
    syncWorld: syncWorld,
    voice: voice,
    cluck: cluck,
    bark: bark,
    chirp: chirp,
    low: low,
    quack: quack,
    wood: wood,
    bell: bell,
    frog: frog,
    laundryPound: laundryPound,
    wheelCreak: wheelCreak,
    gateCreak: gateCreak,
    roosterFlap: roosterFlap,
    roosterCrow: roosterCrow,
    guqinPluck: guqinPluck,
    playValleyEmergence: playValleyEmergence,
    triggerPoeticPhrase: triggerPoeticPhrase,
    setLostMood: function (on) { poeticMusic.lostMood = Boolean(on); },
    gatherSound: gatherSound,
    boatPole: boatPole,
    poleDrip: poleDrip,
    cicadaShimmer: cicadaShimmer,
    fouBeat: fouBeat,
    waterCup: waterCup,
    toastCup: toastCup,
    stagCall: stagCall,
    loomClack: loomClack,
    mortarThud: mortarThud,
    stoolSit: stoolSit,
    frogPlop: frogPlop,
    dewDrop: dewDrop,
    cascadeSplash: cascadeSplash,
    craneCall: craneCall,
    goatBleat: goatBleat,
    teaSimmer: teaSimmer,
    bambooSpring: bambooSpring,
    plowScrape: plowScrape,
    oxLow: oxLow,
    stoneSkip: stoneSkip,
    canopyRain: canopyRain,
    goStoneClick: goStoneClick,
    kilnCrackle: kilnCrackle,
    fouTone: fouTone,
    raftKnock: raftKnock,
    netRustle: netRustle,
    stepSurface: stepSurface,
    setQuietFocus: setQuietFocus,
    setAmbience: setAmbience,
    setUserVolume: setUserVolume,
    setUserMuted: setUserMuted,
    cycleAudioMode: cycleAudioMode,
    getAudioPrefs: getAudioPrefs,
    getLevels: getLevels,
    getStats: getStats,
    debugRecord: debugRecord,
    disposeSamples: () => { stopActiveCrows(); samples.dispose(); },
    get muted() { return Boolean(userMuted || userVolume <= 0.001); },
    get ready() { return ready; },
    get context() { return ctx; }
  };
}
