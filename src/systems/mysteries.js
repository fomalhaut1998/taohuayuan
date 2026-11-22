import { sightBlocked } from './observation.js';
import { fireflyWeather } from '../world/mysteries.js';

const CONTROL = 'input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="textbox"], [role="slider"]';
export function mysteryUiPaused(doc = document) {
  return doc.hidden || (doc.hasFocus && !doc.hasFocus()) || doc.body.classList.contains('map-open') ||
    doc.body.classList.contains('field-guide-open') ||
    doc.body.classList.contains('ui-hidden') || !!doc.getElementById('journal')?.open ||
    !!doc.querySelector?.('dialog[open], [aria-modal="true"]');
}
export function interactionAllowed(event, doc = document) {
  if (mysteryUiPaused(doc)) return false;
  if (doc?.body?.classList?.contains?.('god-flight')) return false;
  if (event && (event.repeat || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) return false;
  for (const target of [event?.target, doc.activeElement]) if (target && (target.isContentEditable || target.closest?.(CONTROL))) return false;
  return true;
}
export function storyBusy(doc = document) {
  return ['subtitle', 'classic', 'plain', 'talk'].some(id => doc.getElementById(id)?.classList.contains('show'));
}

// No keyboard handler here: interaction owns the only E transaction.
export function createMysterySystem(world, { player, sky, sound, field, blockers, doc = document }) {
  const note = doc.getElementById('mystery-note');
  const cooldowns = new Map();
  const filteredBlockers = [];
  let disposed = false, timer = 0, last = null, noteId = null, noteShown = Boolean(note?.classList?.contains?.('show'));
  const available = site => site.id !== 'fireflies' || (fireflyWeather(sky) && (world.states.get(site.id)?.glow || 0) > 0.15);
  function hide() { if (!noteShown) return; noteShown = false; note?.classList.remove('show'); }
  function showNote() { if (noteShown) return; noteShown = true; note?.classList.add('show'); }
  function pickTarget(camera, cfg) {
    if (disposed || !interactionAllowed(null, doc) || storyBusy(doc)) return null;
    const st = player.state, third = st.view === 'third';
    const eye = { x: third ? st.x : camera.position.x, y: third ? st.y + st.eyeHeight : camera.position.y, z: third ? st.z : camera.position.z };
    const cp = Math.cos(st.pitch), forward = { x: -Math.sin(st.yaw) * cp, y: Math.sin(st.pitch), z: -Math.cos(st.yaw) * cp };
    let best = null;
    for (const site of world.sites) {
      if (!available(site) || (cooldowns.get(site.id) || 0) > 0) continue;
      const y = site.y + site.height, dx = site.x - eye.x, dy = y - eye.y, dz = site.z - eye.z;
      const dist = Math.hypot(dx, dy, dz), dot = (dx * forward.x + dy * forward.y + dz * forward.z) / (dist || 1);
      if (Math.hypot(site.x - st.x, site.z - st.z) > 3.5 || dist > 4 || dot < 0.78) continue;
      filteredBlockers.length = 0;
      for (let i = 0; i < blockers.length; i++) {
        if (blockers[i].mysteryId !== site.id) filteredBlockers.push(blockers[i]);
      }
      if (sightBlocked(eye, { x: site.x, y, z: site.z }, filteredBlockers, field)) continue;
      const score = dist + (1 - dot) * cfg.alignBias;
      if (!best || score < best.score) best = { kind: 'mystery', key: 'm:' + site.id, ref: site, name: site.name, label: site.name,
        prompt: site.action + ' · ' + site.name, x: site.x, y, z: site.z, dist, dot, score };
    }
    return best;
  }
  function interact(target) {
    if (disposed || !target || target.kind !== 'mystery' || !interactionAllowed(null, doc) || storyBusy(doc)) return null;
    const site = world.sites.find(s => s === target.ref);
    if (!site || !available(site) || (cooldowns.get(site.id) || 0) > 0 || timer > 0) return null;
    if (!world.activate(site.id)) return null;
    cooldowns.set(site.id, site.cooldown); timer = 4.5; noteId = site.id;
    if (note) { note.textContent = site.line; showNote(); }
    // Genuine E gesture only. Never await/reschedule playback after the UI has been paused.
    try {
      const unlocked = sound?.unlock?.();
      if (unlocked?.catch) unlocked.catch(() => {});
      if (site.id === 'bell') sound?.bell?.(site.x, site.z);
    } catch (_) { /* A silent browser still gives the complete visual response. */ }
    last = { id: site.id, line: site.line };
    return last;
  }
  function update(dt, elapsed) {
    if (disposed) return;
    if (mysteryUiPaused(doc)) { hide(); return; }
    const step = Math.max(0, Math.min(dt, 0.05));
    world.update(step, elapsed, sky);
    for (const [key, left] of cooldowns) { if (left <= step) cooldowns.delete(key); else cooldowns.set(key, left - step); }
    if (noteId === 'fireflies' && !fireflyWeather(sky)) { timer = 0; noteId = null; }
    if (storyBusy(doc)) { hide(); return; }
    if (timer > 0) { timer = Math.max(0, timer - step); if (timer > 0) showNote(); else hide(); }
    else hide();
  }
  function dispose() {
    if (disposed) return; disposed = true; hide(); if (note) note.textContent = '';
    cooldowns.clear(); world.dispose();
  }
  return { pickTarget, interact, update, hide, dispose,
    get busy() { return timer > 0; },
    getState: () => ({ disposed, timer, last, cooldowns: Object.fromEntries(cooldowns), sites: world.sites.map(s => ({ id: s.id, x: s.x, y: s.y, z: s.z, approach: s.approach })) }) };
}
