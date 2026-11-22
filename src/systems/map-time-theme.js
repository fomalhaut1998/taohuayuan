// Pale paper remains readable by moonlight: time changes pigments, never a global filter.
export const MAP_TIME_ANCHORS = Object.freeze(['day', 'dusk', 'night']);
const PIGMENTS = {
  dusk: {
    paper: '#EED6B5', paperWarm: '#DAB183', ink: '#453026', water: '#A9BBA8',
    waterEdge: '#526D5B', peach: '#DC9398', peachDeep: '#BF727E', field: '#92965D',
    crop: '#A4A36A', bamboo: '#777846', mountain: '#ABA28A', mountainDeep: '#8E8470',
    road: '#CDB38C', house: '#D3AF88', roof: '#A2825F', seal: '#983C30',
    yard: '#D9BD95', hay: '#CEAB67', stone: '#AAA18B', cloth: '#E2C8A5',
    willow: '#8C925D', lotus: '#8A9D77', waterLine: '#CDD4B8', mulberry: '#7F814D',
  },
  night: {
    paper: '#BED0D8', paperWarm: '#A4BAC6', ink: '#233A49', water: '#87AFB9',
    waterEdge: '#3B697B', peach: '#BBA1B7', peachDeep: '#9D819F', field: '#809A8E',
    crop: '#95AC99', bamboo: '#526F6C', mountain: '#91A5A9', mountainDeep: '#6C858F',
    road: '#A9B7B8', house: '#B7BBB0', roof: '#7C8B90', seal: '#853F46',
    yard: '#B3C0BA', hay: '#B7B492', stone: '#91A3AC', cloth: '#C3CECD',
    willow: '#809B8F', lotus: '#7E9F9C', waterLine: '#B9D0D4', mulberry: '#66877D',
  },
};

const PHENOLOGY_IDS = ['spring', 'summer', 'autumn', 'winter'];
const PHENOLOGY_TINT_KEYS = [
  'peach', 'peachDeep', 'field', 'crop', 'mulberry',
  'willow', 'hay', 'lotus', 'mountain', 'mountainDeep',
  'roof', 'yard', 'water',
];

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function hex(channels) {
  return '#' + channels.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
export function mixMapColor(a, b, amount) {
  const ca = rgb(a), cb = rgb(b);
  return hex(ca.map((v, i) => v + (cb[i] - v) * amount));
}
export function applyPhenologyPalette(basePalette, phenologyId = 'spring', phenologyMap = null) {
  if (!phenologyId || phenologyId === 'spring' || !phenologyMap || !phenologyMap[phenologyId]) {
    return { ...basePalette };
  }
  return { ...basePalette, ...phenologyMap[phenologyId] };
}
function buildAnchorPalettes(basePalette, phenologyId = 'spring', phenologyMap = null) {
  const dayPal = applyPhenologyPalette(basePalette, phenologyId, phenologyMap);
  const duskPal = mapTimePalette(basePalette, 'dusk');
  const nightPal = mapTimePalette(basePalette, 'night');
  const ov = phenologyId !== 'spring' && phenologyMap ? phenologyMap[phenologyId] : null;
  if (ov) {
    for (let i = 0; i < PHENOLOGY_TINT_KEYS.length; i++) {
      const k = PHENOLOGY_TINT_KEYS[i];
      if (!ov[k]) continue;
      if (duskPal[k]) duskPal[k] = mixMapColor(duskPal[k], ov[k], 0.42);
      if (nightPal[k]) nightPal[k] = mixMapColor(nightPal[k], ov[k], 0.32);
    }
  }
  return [dayPal, duskPal, nightPal];
}
export function mapTimeWeights(timeId) {
  if (timeId === 'night') return [0, 0, 1];
  if (timeId === 'dusk') return [0, 1, 0];
  // The fourth sky state uses the same three cached pigments, gently warmed.
  if (timeId === 'dawn') return [0.72, 0.28, 0];
  return [1, 0, 0];
}
export function mapTimePalette(basePalette, timeId = 'day') {
  // New palette only; old world/config/save objects are never modified.
  if (timeId === 'dawn') return blendMapPalette([mapTimePalette(basePalette), mapTimePalette(basePalette, 'dusk'), mapTimePalette(basePalette, 'night')], mapTimeWeights(timeId));
  return { ...basePalette, ...(PIGMENTS[timeId] || {}) };
}
export function blendMapPalette(palettes, weights) {
  const result = { ...palettes[0] };
  for (const key of Object.keys(result)) {
    const colors = palettes.map(p => rgb(p[key]));
    result[key] = hex([0, 1, 2].map(c => colors.reduce((sum, color, i) => sum + color[c] * weights[i], 0)));
  }
  return result;
}
export function createMapTimeTheme(basePalette, smoothing = 0.55) {
  let phenologyId = 'spring';
  let palettes = MAP_TIME_ANCHORS.map(id => mapTimePalette(basePalette, id));
  let weights = [1, 0, 0], target = [1, 0, 0];
  let timeId = 'day', weatherId = 'clear';
  let palette = { ...basePalette };
  return {
    // dt is accepted for integration compatibility, but ONLY update advances time.
    setTarget(id, _dt, weather) {
      timeId = ['day', 'dawn', 'dusk', 'night'].includes(id) ? id : 'day';
      weatherId = typeof weather === 'string' ? weather : 'clear';
      target = mapTimeWeights(timeId);
    },
    setPhenology(nextId, phenologyMap) {
      const id = PHENOLOGY_IDS.includes(nextId) ? nextId : 'spring';
      if (id === phenologyId) return false;
      phenologyId = id;
      palettes = buildAnchorPalettes(basePalette, phenologyId, phenologyMap);
      palette = blendMapPalette(palettes, weights);
      return true;
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return false;
      const k = 1 - Math.exp(-dt / Math.max(0.001, smoothing));
      let changed = false;
      weights = weights.map((value, i) => {
        const next = Math.abs(target[i] - value) < 0.0012 ? target[i] : value + (target[i] - value) * k;
        changed ||= next !== value;
        return next;
      });
      // Normalize after snapping to preserve exact convex raster/color blending.
      const total = weights.reduce((sum, v) => sum + v, 0);
      weights = weights.map(v => v / total);
      if (changed) palette = blendMapPalette(palettes, weights);
      return changed;
    },
    get palette() { return palette; },
    get weights() { return weights.slice(); },
    get palettes() { return palettes.map(p => ({ ...p })); },
    getStats() { return { timeId, weatherId, phenologyId, weights: weights.slice(), target: target.slice(), paper: palette.paper, ink: palette.ink }; },
  };
}
