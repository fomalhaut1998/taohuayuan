import { Vector3 } from 'three';
import { catalogueEntry } from './catalogue.js';
import { sightBlocked } from './observation.js';
import { collectDiscoveryTargets, resolveDiscoveryTarget, discoveryScore, discoverySightPoint } from './discovery-targets.js';
import { createFieldGuide } from './field-guide.js';

const editable = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function createDiscovery(options = {}) {
  const { camera, player, canvas, journal, field } = options;
  const targets = collectDiscoveryTargets(options);
  const blockers = [...new Set([...(options.blockers || []), ...(options.village?.blockers || []), ...(options.villageLife?.blockers || []),
    ...(options.hinterland?.blockers || []), ...(options.villageScenes?.blockers || []), ...(options.cliff?.blockers || [])])];
  const guide = createFieldGuide({ player, canvas });
  const label = document.createElement('div'); label.className = 'discovery-label'; label.id = 'discovery-label'; label.hidden = true; label.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span'); const key = document.createElement('kbd'); key.textContent = 'G';
  label.append(name, key); document.body.append(label);
  const projected = new Vector3(), cameraEye = new Vector3(), cameraDirection = new Vector3(), toTarget = new Vector3();
  let current = null, enabled = false, disposed = false, elapsed = .18, selections = 0, projections = 0;
  let lastLeft = '', lastTop = '', lastName = '';
  let windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  function allowed() {
    return !disposed && enabled && windowFocused && !document.hidden && !guide.isOpen && !editable(document.activeElement) &&
      !document.body?.classList?.contains?.('god-flight') && !player?.state?.godFlight &&
      !document.body?.classList?.contains?.('cruise-active') &&
      !document.body.classList.contains('map-open') && !document.body.classList.contains('quest-open') && !(typeof journal?.isOpen === 'function' ? journal.isOpen() : journal?.isOpen) &&
      !document.querySelector('dialog[open]') && (typeof options.canOpen !== 'function' || options.canOpen());
  }
  function sight() {
    const s = player?.state;
    if (s) {
      const pitch = s.pitch || 0, yaw = s.yaw || 0;
      return { eye: { x: s.x, y: s.y + (s.eyeHeight ?? 1.6), z: s.z },
        forward: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) } };
    }
    if (!camera) return null;
    camera.getWorldPosition(cameraEye); camera.getWorldDirection(cameraDirection);
    return { eye: cameraEye, forward: cameraDirection };
  }
  function valid(target, view) {
    if (!target || !view) return null;
    const resolved = resolveDiscoveryTarget(target);
    return Number.isFinite(discoveryScore(view.eye, view.forward, resolved, blockers, field)) ? resolved : null;
  }
  function project(target) {
    if (!camera || !target) { label.hidden = true; return false; }
    camera.updateMatrixWorld(); camera.getWorldPosition(cameraEye); camera.getWorldDirection(cameraDirection);
    projected.set(target.x, target.y, target.z);
    if (toTarget.copy(projected).sub(cameraEye).dot(cameraDirection) <= 0 || sightBlocked(cameraEye, discoverySightPoint(cameraEye, target), blockers, field)) { label.hidden = true; return false; }
    projected.project(camera); projections++;
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > .94 || Math.abs(projected.y) > .92) { label.hidden = true; return false; }
    const rect = canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const x = rect.left + (projected.x * .5 + .5) * rect.width, y = rect.top + (-projected.y * .5 + .5) * rect.height;
    const nextLeft = x + 'px', nextTop = y + 'px', nextName = catalogueEntry(target.id).name;
    if (label.style) {
      if (nextLeft !== lastLeft) { lastLeft = nextLeft; label.style.left = nextLeft; }
      if (nextTop !== lastTop) { lastTop = nextTop; label.style.top = nextTop; }
    }
    if (nextName !== lastName) { lastName = nextName; name.textContent = nextName; }
    if (key.hidden) key.hidden = false;
    if (label.hidden) label.hidden = false;
    return true;
  }
  let emptyHintUntil = 0;
  function clear() {
    current = null;
    emptyHintUntil = 0;
    lastLeft = '';
    lastTop = '';
    lastName = '';
    label.classList?.remove?.('discovery-label--hint');
    label.hidden = true;
    elapsed = .18;
  }
  function select(view) {
    selections++; let best = null, score = Infinity;
    for (const t of targets) {
      const p = resolveDiscoveryTarget(t); const s = discoveryScore(view.eye, view.forward, p, blockers, field);
      if (s < score) { score = s; best = t; }
    }
    current = best; elapsed = 0;
  }
  function blur() { windowFocused = false; enabled = false; clear(); }
  function focus() { windowFocused = true; elapsed = .18; }
  function visibility() { if (document.hidden) { enabled = false; clear(); } }
  function openCurrent() {
    if (!allowed() || !current) return false;
    // G never records a stale cone/range/occlusion result, even between selection ticks.
    const target = valid(current, sight());
    if (!target || !project(target)) { clear(); return false; }
    const entry = catalogueEntry(target.id);
    if (!entry || !guide.open(entry, false)) return false;
    const fresh = typeof journal?.observe === 'function' ? journal.observe(target.id) : false;
    guide.setRecorded(fresh); clear(); return true;
  }
  function onLabelClick(e) {
    if (disposed || label.hidden || label.classList?.contains?.('discovery-label--hint') || !current) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    openCurrent();
  }
  label.addEventListener?.('click', onLabelClick);
  window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
  return {
    update(dt, active = true) {
      if (disposed) return;
      enabled = active === true;
      if (!allowed()) { clear(); return; } // A detail stays open during paused updates.
      const view = sight(); if (!view) { clear(); return; }
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      elapsed += step;
      if (emptyHintUntil > 0) emptyHintUntil = Math.max(0, emptyHintUntil - step);
      if (elapsed >= .18) select(view);
      const target = valid(current, view);
      if (!target) {
        current = null;
        if (emptyHintUntil > 0) {
          const hintName = '近处无可识之物';
          if (hintName !== lastName) { lastName = hintName; name.textContent = hintName; }
          if (!key.hidden) key.hidden = true;
          label.classList?.add?.('discovery-label--hint');
          if (label.style) {
            if (lastLeft !== '50%') { lastLeft = '50%'; label.style.left = '50%'; }
            if (lastTop !== '58%') { lastTop = '58%'; label.style.top = '58%'; }
          }
          if (label.hidden) label.hidden = false;
        } else {
          label.classList?.remove?.('discovery-label--hint');
          if (!label.hidden) label.hidden = true;
        }
        return;
      }
      emptyHintUntil = 0;
      label.classList?.remove?.('discovery-label--hint');
      project(target); // Projection and current-target rejection are never throttled.
    },
    nudgeEmpty() {
      if (disposed || !allowed() || current) return false;
      emptyHintUntil = 1.6;
      return true;
    },
    openCurrent,
    close() { guide.close(); clear(); },
    get isOpen() { return guide.isOpen; },
    get current() { const t = allowed() ? valid(current, sight()) : null; return t ? { id: t.id, name: catalogueEntry(t.id).name, x: t.x, y: t.y, z: t.z, range: t.range, source: t.source } : null; },
    getStats() { return { targets: targets.length, kinds: [...new Set(targets.map(t => t.id))], dynamicTargets: targets.filter(t => t.resolve).length, selections, projections, labelVisible: !label.hidden, isOpen: guide.isOpen }; },
    dispose() { if (disposed) return; disposed = true; clear(); guide.dispose(); label.removeEventListener?.('click', onLabelClick); label.remove(); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); }
  };
}
