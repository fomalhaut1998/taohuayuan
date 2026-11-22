import { catalogueEntry } from './catalogue.js';
import { observationScore } from './observation.js';

const ANIMALS = new Set(['chicken', 'dog', 'bird', 'ox', 'duck']);
const LIFE = { vegetableBed: ['garden', .3, 'bed'], well: ['well', .7, 'well'], stoneMill: ['stone-mill', .85, 'mill'],
  dryingRack: ['drying-rack', 1.25, 'rack'], firewood: ['woodpile', .4, 'woodpile'], chickenCoop: ['coop', .75, 'coop'],
  scarecrow: ['scarecrow', 1.2, 'scarecrow'], clayJars: ['jars', .5, 'jars'], gourdTrellis: ['trellis', 1.5, 'trellis'], stoneBench: ['bench', .45, 'bench'] };
const PROPS = { well: ['well', .65], mill: ['stone-mill', .6], woodpile: ['woodpile', .4], jars: ['jars', .45], vat: ['vat', .65],
  basket: ['basket', .3], thresh: ['thresh', .15], 'drying-mat': ['drying-mat', .12], garden: ['garden', .25],
  clothesline: ['clothesline', 1.2], bench: ['bench', .5], coop: ['coop', .7] };

// Every descriptor comes from a generator's successful-placement output, never its config candidate list.
export function collectDiscoveryTargets(options = {}) {
  const { field, flora, village, hinterland, villageLife, props, boats, cliff, riverSpine, fauna, habitatDetails, pondLife, waterworks, leisureGrove, qinHanHomestead, world } = options;
  const targets = [];
  const ground = (x, z) => field && typeof field.sample === 'function' ? field.sample(x, z) : NaN;
  function add(id, x, y, z, range = 7, source = '', extra = {}) {
    if (!catalogueEntry(id) || ![x, y, z, range].every(Number.isFinite)) return;
    targets.push({ id, x, y, z, range, source, ...extra });
  }
  for (const p of new Set([...(flora?.spots || []), ...(flora?.nearSpots || [])])) add('peach', p[0], p[1] + 1.3, p[2], 8, 'flora');
  for (const p of village?.bamboo || []) add('bamboo', p[0], ground(p[0], p[1]) + 1.4, p[1], 7, 'village-bamboo');
  for (const p of village?.mulberry || []) add('mulberry', p[0], ground(p[0], p[1]) + p[3] * .7, p[1], 8, 'village-mulberry');
  for (const p of hinterland?.trees || []) if (p.kind === 'mulberry') {
    const ownBlocker = (hinterland.blockers || []).find(b => b.source === 'trunk' && b.x === p.x && b.z === p.z && b.hw <= .4 && b.hd <= .4 && b.minY === p.y - .1 && b.maxY === p.y + p.height * .52);
    add('mulberry', p.x, p.y + 1.3, p.z, 8, 'hinterland-tree', { ownBlocker });
  }
  for (const p of hinterland?.bamboo || []) {
    const ownBlocker = (hinterland.blockers || []).find(b => b.source === 'bamboo' && b.x === p.x && b.z === p.z && b.hw === .26 && b.hd === .26 && b.minY === p.y && b.maxY === p.y + p.height);
    add('bamboo', p.x, p.y + 1.4, p.z, 7, 'hinterland-bamboo', { ownBlocker });
  }
  for (const p of village?.plots || []) add('field', p[0], ground(p[0], p[1]) + .18, p[1], 7, 'village-plot');
  const pond = village?.pond;
  if (pond) add('pond', pond.x, pond.waterY + .12, pond.z, 10, 'village-pond');
  if (cliff?.slit) add('cave', cliff.slit.x, cliff.slit.ground + 1.2, cliff.slit.z, 8, 'cliff-slit');
  for (const p of riverSpine || []) add('stream', p[0], world?.terrain?.waterLevel + .12, p[1], 7, 'river-spine');
  for (const m of props?.marks || []) {
    if (m.kind === 'tree' && m.blossom) add('peach', m.x, ground(m.x, m.z) + 1.3, m.z, 8, 'props-tree');
    const def = PROPS[m.kind];
    if (def) add(def[0], m.x, ground(m.x, m.z) + def[1], m.z, 6, 'props-' + m.kind);
  }
  (villageLife?.items || []).forEach((p, i) => {
    const def = LIFE[p.kind]; if (!def) return;
    // Exact source + part + center identity only. Large structures are never exempted from LOS.
    const ownBlocker = (villageLife.blockers || []).find(b => b.source === p.kind + '-' + i && b.part === def[2] &&
      Math.hypot(b.x - p.x, b.z - p.z) < .01 && b.hw > 0 && b.hd > 0 && b.hw <= 1.6 && b.hd <= 1.6);
    add(def[0], p.x, ground(p.x, p.z) + def[1], p.z, 6, 'village-life-' + i, { ownBlocker });
  });
  for (const p of habitatDetails?.targets || []) add(p.id, p.x, p.y, p.z, p.range || 6, 'habitat');
  // Round six generators expose only their successful visible placements, never config guesses.
  const seenRefs = new Set();
  for (const [scene, source] of [[pondLife, 'pond-life'], [waterworks, 'waterworks'], [leisureGrove, 'leisure-grove'], [qinHanHomestead, 'qin-han-homestead']]) {
    for (const p of scene?.targets || []) {
      if (seenRefs.has(p)) continue;
      seenRefs.add(p);
      add(p.id, p.x, p.y, p.z, p.range ?? 6, source, {
        ...(typeof p.resolve === 'function' ? { resolve: p.resolve } : {}),
        ...(p.ownBlocker ? { ownBlocker: p.ownBlocker } : {})
      });
    }
  }
  for (const a of fauna?.animals || []) if (ANIMALS.has(a.kind)) {
    const height = world?.interaction?.heights?.[a.kind] ?? (a.kind === 'ox' ? .8 : .3);
    add(a.kind, a.x, a.y + (a.lift || 0) + height, a.z, 6, 'fauna', { resolve: () => ({ x: a.x, y: a.y + (a.lift || 0) + height, z: a.z }) });
  }
  for (const mesh of boats?.group?.children || []) if (/^boat-\d+$/.test(mesh.name) && mesh.position) {
    const p = mesh.position;
    add('boat', p.x, p.y + .3, p.z, 7, mesh.name, { resolve: () => ({ x: p.x, y: p.y + .3, z: p.z }) });
  }
  return targets;
}

export function resolveDiscoveryTarget(target) {
  const p = target.resolve ? target.resolve() : target;
  return { ...target, x: p.x, y: p.y, z: p.z };
}

// End a ray just in front of an exact small object's own box, not behind its opaque body.
// No blocker is ignored, so a house or another object on the same ray still wins.
export function discoverySightPoint(eye, target) {
  const b = target.ownBlocker;
  if (!b || !Number.isFinite(b.minY) || !Number.isFinite(b.maxY) || target.y < b.minY || target.y > b.maxY) return target;
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const ex = (eye.x - b.x) * c - (eye.z - b.z) * s, ez = (eye.x - b.x) * s + (eye.z - b.z) * c;
  if (Math.abs(ex) <= b.hw && Math.abs(ez) <= b.hd) return target;
  const dx = (target.x - eye.x) * c - (target.z - eye.z) * s;
  const dz = (target.x - eye.x) * s + (target.z - eye.z) * c;
  let lo = 0, hi = 1;
  for (const [v, d, h] of [[ex, dx, b.hw], [ez, dz, b.hd]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(v) > h) return target; }
    else { const a = (-h - v) / d, q = (h - v) / d; lo = Math.max(lo, Math.min(a, q)); hi = Math.min(hi, Math.max(a, q)); }
  }
  if (lo > hi || lo <= 0 || lo > 1) return target;
  const t = Math.max(0, lo - .015);
  return { x: eye.x + (target.x - eye.x) * t, y: eye.y + (target.y - eye.y) * t, z: eye.z + (target.z - eye.z) * t };
}

export function discoveryScore(eye, forward, target, blockers, field) {
  // Range/cone use the real center first; the shortened surface ray must not extend range.
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z, d = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(d) || d < .01 || d > target.range) return Infinity;
  const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
  if (dot < .82) return Infinity;
  const p = discoverySightPoint(eye, target);
  if (!Number.isFinite(observationScore(eye, forward, p, target.range, blockers, field))) return Infinity;
  return d / target.range + (1 - dot) * 2;
}
