// Visual-only defaults: never mutate world.json or logical time/weather settings.
// CSS colours are converted to linear RGB by the sky's existing THREE.Color.set.
const PALETTES = {
  dawn: {
    top: '#6086BC',
    bottom: '#F4C8A2',
    fog: '#D6B7A4',
    cloud: '#FBE0C9',
    sun: '#FFD9A4',
    hemi: '#E6D1C4',
    hemiGround: '#8D986D',
    glow: '#FFC688',
    glowI: 0.44,
    fogNear: 52,
    fogFar: 296,
    hillBlend: 0.42
  },
  dusk: {
    top: '#3B5080',
    bottom: '#E89B74',
    fog: '#BA8C82',
    cloud: '#F2B99E',
    sun: '#FFB27A',
    hemi: '#CFA99F',
    hemiGround: '#757B5D',
    glow: '#FF9B64',
    glowI: 0.54,
    fogNear: 54,
    fogFar: 292,
    hillBlend: 0.48
  }
};
export function applyTwilightPalette(target, timeId) {
  const p = PALETTES[timeId];
  if (!p) return;
  target.skyTop.set(p.top); target.skyBottom.set(p.bottom); target.fog.set(p.fog);
  target.cloud.set(p.cloud); target.sun.set(p.sun); target.hemiSky.set(p.hemi);
  if (p.hemiGround && target.hemiGround) target.hemiGround.set(p.hemiGround);
  target.glow.set(p.glow); target.glowI = p.glowI;
  if (Number.isFinite(p.fogNear)) target.fogNear = p.fogNear;
  if (Number.isFinite(p.fogFar)) target.fogFar = p.fogFar;
  if (Number.isFinite(p.hillBlend)) target.hillBlend = p.hillBlend;
}
export function twilightWeatherGate(cover, low, extinction) {
  const clearAir = Math.max(0, Math.min(1, 1 - extinction));
  return clearAir * Math.max(0, 1 - low * .85) * Math.max(0, 1 - Math.max(0, cover - .5) * .6);
}
