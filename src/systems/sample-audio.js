// Recorded one-shots only: no synthesized speech, pitch shifting, remote URLs or dependencies.
// Call unlock from a real gesture. Loading is intentionally silent until decode completes.
export const SAMPLE_DEFAULTS = Object.freeze({
  enabled: true, gain: 0.65, maxConcurrent: 6, maxVoices: 2, maxAmbientVoices: 1,
  emitterCooldown: 1.8, ambientCooldown: 9, interactionHold: 2.8,
  repeatWindow: 12, maxClipSeconds: 8, maxDecodedBytes: 48 * 1024 * 1024,
  maxEncodedBytes: 24 * 1024 * 1024, loadConcurrency: 3, loadTimeoutMs: 15000
});
const CATEGORIES = new Set(['voice-ack', 'voice-laugh', 'cluck', 'crow', 'frog', 'stag', 'bark', 'chirp', 'low', 'quack', 'river', 'leaves']);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

// public-relative assets stay under the deployed base, never the origin root.
export function resolveSampleUrl(src, baseUrl) {
  if (typeof src !== 'string') return null;
  const path = src.replace(/^public\//, '').replace(/^\/(?!\/)/, '');
  if (!path || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some(p => p === '..' || p === '.') || path.startsWith('/')) return null;
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) return null;
    const url = new URL(path, base);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.href : null;
  } catch (_) { return null; }
}

export function createSampleAudio({ catalogue = { version: 1, clips: [] }, config = {}, fetch: fetcher = globalThis.fetch, baseUrl = 'http://localhost/', random = Math.random } = {}) {
  const cfg = { ...SAMPLE_DEFAULTS, ...config };
  for (const key of Object.keys(SAMPLE_DEFAULTS)) {
    if (key !== 'enabled') cfg[key] = finite(cfg[key], SAMPLE_DEFAULTS[key]);
  }
  cfg.gain = clamp(cfg.gain, 0, 1);
  for (const key of ['maxConcurrent', 'maxVoices', 'maxAmbientVoices', 'loadConcurrency']) cfg[key] = Math.floor(clamp(cfg[key], 1, 12));
  for (const key of ['maxDecodedBytes', 'maxEncodedBytes', 'maxClipSeconds', 'loadTimeoutMs']) cfg[key] = Math.max(1, cfg[key]);
  const entries = [];
  const ids = new Set();
  for (const clip of catalogue?.version === 1 && Array.isArray(catalogue.clips) ? catalogue.clips : []) {
    if (!clip || typeof clip.id !== 'string' || ids.has(clip.id) || !CATEGORIES.has(clip.category)) continue;
    ids.add(clip.id);
    entries.push({ clip, url: resolveSampleUrl(clip.src, baseUrl), status: 'unloaded', buffer: null });
  }
  let ctx = null, output = null, disposed = false, muted = false, unlocked = false;
  let unlockPromise = null, loadPromise = null, decodedBytes = 0, encodedBytes = 0;
  let interactionUntil = -Infinity;
  let hasListener = false;
  const listener = { x: 0, z: 0, yaw: 0 };
  const active = new Set(), cooldowns = new Map(), previous = new Map(), controllers = new Set();
  const counts = { played: 0, skipped: 0, failed: 0, ended: 0 };
  const time = () => finite(ctx?.currentTime);
  const isVoice = category => category.startsWith('voice-');

  function attach(context, destination) {
    if (disposed || (ctx && ctx !== context)) return false;
    ctx = context; output = destination;
    return !!ctx && !!output;
  }
  async function load(entry) {
    if (disposed) return;
    if (!entry.url || typeof fetcher !== 'function') { entry.status = 'failed'; counts.failed++; return; }
    entry.status = 'loading';
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), cfg.loadTimeoutMs);
    try {
      if (finite(entry.clip.bytes) > cfg.maxEncodedBytes) throw new Error('Encoded sample exceeds budget');
      const response = await fetcher(entry.url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sample HTTP failure');
      const bytes = await response.arrayBuffer();
      if (disposed) return;
      if (!bytes.byteLength || encodedBytes + bytes.byteLength > cfg.maxEncodedBytes) throw new Error('Encoded budget exhausted');
      encodedBytes += bytes.byteLength;
      // Modern Promise decode API; decode is never repeated for a successful or failed entry.
      const buffer = await ctx.decodeAudioData(bytes);
      if (disposed) return;
      const size = buffer.length * buffer.numberOfChannels * 4;
      if (!(buffer.duration > 0) || !Number.isFinite(size) || decodedBytes + size > cfg.maxDecodedBytes) throw new Error('Decoded budget exhausted');
      const start = finite(entry.clip.trimStart);
      const end = finite(entry.clip.trimEnd, buffer.duration);
      if (start < 0 || end <= start || start >= buffer.duration) throw new Error('Invalid clip trim');
      entry.buffer = buffer; decodedBytes += size; entry.status = 'ready';
    } catch (_) {
      if (!disposed) { entry.status = 'failed'; counts.failed++; }
    } finally {
      clearTimeout(timeout); controllers.delete(controller);
    }
  }
  function preload() {
    if (loadPromise) return loadPromise;
    let cursor = 0;
    loadPromise = Promise.all(Array.from({ length: Math.min(cfg.loadConcurrency, entries.length) }, async () => {
      while (!disposed && cursor < entries.length) await load(entries[cursor++]);
    })).then(() => !disposed).catch(() => false);
    return loadPromise;
  }
  function unlock() {
    if (disposed || !ctx || !output || ctx.state === 'closed') return Promise.resolve(false);
    if (unlockPromise) return unlockPromise;
    // resume is invoked synchronously while the browser still owns the user gesture.
    let resume;
    try { resume = (ctx.state === 'suspended' || ctx.state === 'interrupted') ? ctx.resume() : undefined; }
    catch (_) { return Promise.resolve(false); }
    unlockPromise = Promise.resolve(resume).then(async () => {
      if (disposed || ctx.state !== 'running') return false;
      unlocked = true;
      if (cfg.enabled) await preload();
      return !disposed;
    }).catch(() => false).finally(() => { unlockPromise = null; });
    return unlockPromise;
  }
  function cleanup(record) {
    if (!active.delete(record)) return;
    record.source.onended = null;
    for (const node of record.nodes) { try { node.disconnect(); } catch (_) { /* already disconnected */ } }
    record.source.buffer = null;
    counts.ended++;
  }
  function stop(record) {
    try { record.source.stop(); } catch (_) { /* already stopped */ }
    cleanup(record);
  }
  function spatial(record, initial = false) {
    const dx = record.x - listener.x, dz = record.z - listener.z;
    const distance = Math.hypot(dx, dz);
    const gain = record.gain / (1 + distance / record.falloff);
    const pan = clamp((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / (distance + 5), -1, 1) * 0.82;
    const cutoff = clamp(15000 / (1 + distance / 22), 900, 15000);
    if (initial) record.spatialGain.gain.setValueAtTime(gain, time());
    else record.spatialGain.gain.value = gain;
    if (record.pan) record.pan.pan.value = pan;
    record.filter.frequency.value = cutoff;
  }
  function play(category, opts = {}) {
    if (disposed || muted || !unlocked || !cfg.enabled || ctx?.state !== 'running') { counts.skipped++; return false; }
    const t = time(), human = isVoice(category), ambient = !!opts.ambient;
    const x = finite(opts.x, listener.x), z = finite(opts.z, listener.z);
    const emitter = String(opts.emitterId ?? category + ':' + Math.round(x / 2) + ':' + Math.round(z / 2));
    const key = (human ? 'voice' : category) + ':' + (ambient ? 'ambient:' : 'explicit:') + emitter;
    const gap = Math.max(0, ambient ? cfg.ambientCooldown : cfg.emitterCooldown);
    if (ambient && t < interactionUntil || t - (cooldowns.get(key) ?? -Infinity) < gap) { counts.skipped++; return false; }
    if (human && !ambient) {
      interactionUntil = t + Math.max(0, cfg.interactionHold);
      for (const record of active) if (record.ambient) stop(record);
    }
    if ([...active].some(r => r.emitter === emitter && (human ? r.human : r.category === category))) { counts.skipped++; return false; }
    const voices = [...active].filter(r => r.human);
    if (active.size >= cfg.maxConcurrent || human && (voices.length >= cfg.maxVoices || ambient && voices.filter(r => r.ambient).length >= cfg.maxAmbientVoices)) { counts.skipped++; return false; }
    const last = previous.get(category);
    let candidates = entries.filter(e => e.clip.category === category && e.status === 'ready' && e.clip.id !== last?.id);
    // A one-recording category may repeat only after a long quiet gap, never immediately.
    if (!candidates.length && (!last || t - last.time >= cfg.repeatWindow)) candidates = entries.filter(e => e.clip.category === category && e.status === 'ready');
    if (!candidates.length || finite(opts.gain, 1) <= 0 || cfg.gain <= 0) { counts.skipped++; return false; }
    const entry = candidates[Math.floor(clamp(finite(random()), 0, 0.999999) * candidates.length)];
    const start = finite(entry.clip.trimStart);
    const end = Math.min(entry.buffer.duration, finite(entry.clip.trimEnd, entry.buffer.duration));
    const duration = Math.min(end - start, cfg.maxClipSeconds);
    if (!(duration > 0)) { counts.skipped++; return false; }
    const nodes = [];
    let record;
    try {
      const source = ctx.createBufferSource(); nodes.push(source); source.buffer = entry.buffer;
      source.playbackRate.value = 1; // Preserve recorded identity; roles do not pitch-shift humans.
      const envelope = ctx.createGain(); nodes.push(envelope);
      const spatialGain = ctx.createGain(); nodes.push(spatialGain);
      const filter = ctx.createBiquadFilter(); nodes.push(filter); filter.type = 'lowpass'; filter.Q.value = 0.4;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) nodes.push(pan);
      source.connect(envelope); envelope.connect(spatialGain); spatialGain.connect(filter);
      if (pan) { filter.connect(pan); pan.connect(output); } else filter.connect(output);
      const when = t + 0.012, attack = Math.min(0.015, duration / 4), release = Math.min(0.065, duration / 3);
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(1, when + attack);
      envelope.gain.setValueAtTime(1, when + duration - release);
      envelope.gain.linearRampToValueAtTime(0, when + duration);
      record = { source, nodes, spatialGain, filter, pan, human, ambient, emitter, category, x, z, gain: cfg.gain * clamp(finite(opts.gain, 1), 0, 1) * (ambient ? 0.52 : 0.8), falloff: Math.max(1, finite(opts.falloff, human ? 13 : 16)) };
      spatial(record, true);
      active.add(record);
      source.onended = () => cleanup(record);
      source.start(when, start, duration);
      cooldowns.set(key, t); previous.set(category, { id: entry.clip.id, time: t });
      // Cooldowns for absent/moving emitters cannot grow for the life of a session.
      if (cooldowns.size > 512) for (const [id, at] of cooldowns) if (t - at > Math.max(cfg.ambientCooldown, cfg.emitterCooldown, 30)) cooldowns.delete(id);
      while (cooldowns.size > 512) cooldowns.delete(cooldowns.keys().next().value);
      counts.played++;
      return true;
    } catch (_) {
      if (record) cleanup(record);
      else for (const node of nodes) { try { node.disconnect(); } catch (_) {} }
      counts.failed++;
      return false;
    }
  }
  function setListener(next = {}) {
    const nx = finite(next.x, listener.x);
    const nz = finite(next.z, listener.z);
    const nyaw = finite(next.yaw, listener.yaw);
    const moved = !hasListener || Math.abs(nx - listener.x) > 1e-5 || Math.abs(nz - listener.z) > 1e-5 || Math.abs(nyaw - listener.yaw) > 1e-5;
    listener.x = nx;
    listener.z = nz;
    listener.yaw = nyaw;
    hasListener = true;
    if (moved) for (const record of active) spatial(record);
  }
  function setMuted(value) { muted = !!value; if (muted) for (const record of active) stop(record); }
  // Hot-path state query: do not build getStats() or conflate missing samples with mute.
  function isMuted() { return muted; }
  function dispose() {
    disposed = true; unlocked = false;
    for (const controller of controllers) controller.abort();
    for (const record of active) stop(record);
    for (const entry of entries) { entry.buffer = null; entry.status = 'disposed'; }
    cooldowns.clear(); previous.clear(); decodedBytes = 0;
    output = null;
  }
  function getStats() {
    const status = { unloaded: 0, loading: 0, ready: 0, failed: 0, disposed: 0 };
    for (const entry of entries) status[entry.status]++;
    return { enabled: !!cfg.enabled, unlocked, muted, disposed, context: ctx?.state ?? 'none', clips: entries.length,
      load: status, active: active.size, activeVoices: [...active].filter(r => r.human).length,
      decodedBytes, encodedBytes, budgets: { maxConcurrent: cfg.maxConcurrent, maxVoices: cfg.maxVoices, maxAmbientVoices: cfg.maxAmbientVoices, maxDecodedBytes: cfg.maxDecodedBytes, maxEncodedBytes: cfg.maxEncodedBytes }, counts: { ...counts } };
  }
  function pickBuffer(category) {
    if (disposed || muted || !unlocked || !cfg.enabled || ctx?.state !== 'running') return null;
    const t = time();
    const last = previous.get(category);
    let candidates = entries.filter(e => e.clip.category === category && e.status === 'ready' && e.clip.id !== last?.id);
    if (!candidates.length) candidates = entries.filter(e => e.clip.category === category && e.status === 'ready');
    if (!candidates.length) return null;
    const entry = candidates[Math.floor(clamp(finite(random()), 0, 0.999999) * candidates.length)];
    previous.set(category, { id: entry.clip.id, time: t });
    return entry.buffer;
  }
  return { attach, unlock, play, pickBuffer, setListener, setMuted, isMuted, dispose, getStats };
}
