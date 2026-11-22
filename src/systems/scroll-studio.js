// 丹青留影 · 宣纸立轴题跋：零白屏画卷拍照、横卷/立轴双装裱与游记「画匣」珍藏系统。

import {
  CLASSICAL_COLOPHONS,
  analyzeScrollScene,
  buildScrollColophonQueue,
  resolveExpandedRegionAt
} from './scroll-colophons.js';
import { isModalBusy, isEditableTarget, isVeilBlocking as sharedIsVeilBlocking } from './modal-state.js';
import wildsEggsCfg from '../data/wilds-easter-eggs.json' with { type: 'json' };

export { CLASSICAL_COLOPHONS };

const STORAGE_KEY = 'taohua.scrolls.v1';
const ORIGINAL_DB_NAME = 'taohua.scrolls.originals.v1';
const ORIGINAL_DB_VERSION = 1;
const ORIGINAL_STORE_NAME = 'originals';
const MAX_SAVED_SCROLLS = 8;
const MAX_EXPORT_SCALE = 2.5;
const PREVIEW_THUMB_WIDTH = 800;
const PREVIEW_THUMB_QUALITY = 0.86;
const MAX_PANORAMIC_WIDTH = 12000;
const SERIF_FONT = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif';

const HANDSCROLL_SIZE = { width: 1360, height: 820, heartX: 68, heartY: 50, heartW: 1224, heartH: 590 };
const HANGING_SIZE = { width: 1280, height: 860, heartX: 72, heartY: 110, heartW: 940, heartH: 640 };

const TIME_SUFFIX = {
  dawn: '晓',
  day: '昼',
  dusk: '暮',
  night: '夜'
};

const WEATHER_PREFIX = {
  clear: '晴',
  mist: '烟',
  rain: '雨',
  wind: '风',
  snow: '雪'
};

const PHENOLOGY_SHORT = {
  spring: '春深',
  summer: '夏荷',
  autumn: '秋粟',
  winter: '冬雪'
};

export const BRUSH_STYLES = [
  { id: 'qinglv', name: '青绿重彩', short: '青绿' },
  { id: 'qianjiang', name: '浅绛淡彩', short: '浅绛' },
  { id: 'shuimo', name: '水墨留白', short: '水墨' }
];

const STUDIO_CSS = `
#scroll-open {
  position: fixed;
  left: 92px;
  top: 18px;
  z-index: 8;
  padding: 8px 12px;
  font-family: ${SERIF_FONT};
  font-size: 13px;
  line-height: normal;
  letter-spacing: .18em;
  color: #221d17;
  background: rgba(244, 237, 222, .92);
  border: 1px solid rgba(66, 55, 41, .3);
  border-radius: 2px;
  box-shadow: 0 2px 10px rgba(24, 20, 15, .12);
  cursor: pointer;
  transition: background-color .2s ease, border-color .2s ease, color .35s ease;
}
#scroll-open span {
  font-size: 10px;
  opacity: .76;
  letter-spacing: 0;
}
#scroll-open:hover {
  background: rgba(235, 224, 200, .98);
  border-color: rgba(164, 58, 46, .48);
}
body.is-night #scroll-open {
  color: #f2ead9;
  background: rgba(20, 27, 33, .90);
  border-color: rgba(231, 223, 206, .32);
  box-shadow: 0 4px 18px rgba(6, 10, 14, .42), inset 0 0 0 1px rgba(239, 231, 214, .08);
}
body.is-night #scroll-open:hover {
  background: rgba(34, 44, 52, .94);
  border-color: rgba(240, 196, 136, .55);
}
#scroll-open:focus-visible {
  outline: 2px solid #a44f40;
  outline-offset: 3px;
}
@media (max-width: 900px) {
  #scroll-open { top: 14px; left: 86px; }
}
@media (max-width: 600px) {
  #scroll-open { top: 12px; left: 80px; padding: 6px 10px; font-size: 12px; letter-spacing: .14em; }
}
@media (max-width: 480px) {
  #scroll-open { top: 12px; left: 72px; padding: 6px 8px; font-size: 11.5px; letter-spacing: .1em; }
}
@media (max-height: 540px) {
  #scroll-open { top: 10px; padding: 6px 10px; }
}
body.map-open #scroll-open,
body.ui-hidden #scroll-open,
body.field-guide-open #scroll-open,
body.ink-epilogue-open #scroll-open,
body:has(#veil:not(.curtain-gone):not([hidden])):not(.curtain-open) #scroll-open,
body:has(#veil.on) #scroll-open,
body:has(#veil.ink-transition) #scroll-open,
body:has(#veil.ink-epilogue) #scroll-open {
  visibility: hidden !important;
  pointer-events: none !important;
}
#scroll-dialog {
  position: fixed;
  margin: auto;
  width: min(880px, 94vw);
  max-height: min(90vh, 860px);
  overflow: auto;
  padding: clamp(20px, 3.4vw, 34px);
  color: #302c27;
  background: #f2ead9;
  border: 1px solid #a99a81;
  box-shadow: 0 22px 84px rgba(23, 26, 24, .56);
  font-family: ${SERIF_FONT};
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 112, 88, 0.44) transparent;
}
#scroll-dialog::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
#scroll-dialog::-webkit-scrollbar-thumb {
  background: rgba(128, 112, 88, 0.42);
  border-radius: 999px;
}
#scroll-dialog::-webkit-scrollbar-track {
  background: transparent;
}
#scroll-dialog::backdrop {
  background: rgba(25, 31, 27, .62);
}
.scroll-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #aa9d86;
  padding-bottom: 12px;
}
.scroll-dialog__eyebrow {
  color: #a43a2e;
  font-size: 11px;
  letter-spacing: .3em;
}
.scroll-dialog__head h2 {
  font-size: 26px;
  font-weight: normal;
  letter-spacing: .24em;
  margin-top: 6px;
}
#scroll-dialog button {
  font: inherit;
  font-size: 13px;
  letter-spacing: .12em;
  color: #302c27;
  background: rgba(247, 240, 226, .75);
  border: 1px solid #b8a991;
  padding: 7px 13px;
  cursor: pointer;
  transition: background-color .18s ease, border-color .18s ease;
}
#scroll-dialog button:hover,
#scroll-dialog button:focus-visible {
  background: rgba(235, 224, 200, .95);
  border-color: #a43a2e;
  outline: 2px solid #a44f40;
  outline-offset: 2px;
}
#scroll-dialog button.scroll-btn--seal {
  background: rgba(164, 58, 46, .9);
  color: #faf3e4;
  border-color: rgba(138, 42, 32, .95);
}
#scroll-dialog button.scroll-btn--seal:hover {
  background: rgba(146, 48, 37, .98);
}
.scroll-dialog__stage {
  margin-top: 16px;
  padding: 12px;
  background: rgba(56, 48, 38, .07);
  border: 1px solid rgba(120, 104, 82, .24);
  display: flex;
  align-items: center;
  justify-content: center;
}
#scroll-preview-canvas {
  display: block;
  max-width: 100%;
  max-height: 54vh;
  width: auto;
  height: auto;
  box-shadow: 0 10px 30px rgba(34, 28, 22, .2);
}
.scroll-dialog__meta {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 16px;
  font-size: 12.5px;
  color: #665d50;
  letter-spacing: .1em;
}
.scroll-dialog__seal-tag {
  color: #a43a2e;
  border: 1px solid rgba(164, 58, 46, .55);
  padding: 1px 7px;
  font-size: 11.5px;
  letter-spacing: .16em;
}
.scroll-dialog__cues {
  margin-top: 6px;
  font-size: 12px;
  color: #746756;
  letter-spacing: .08em;
  line-height: 1.5;
}
.scroll-dialog__cues:empty {
  display: none;
}
.scroll-dialog__actions {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #cbbda5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.scroll-dialog__custom {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(138, 121, 95, .36);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  font-size: 12.5px;
  color: #5b5043;
}
.scroll-dialog__custom label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  letter-spacing: .1em;
}
.scroll-dialog__custom input {
  font-family: ${SERIF_FONT};
  font-size: 12.5px;
  letter-spacing: .08em;
  color: #2b251f;
  background: rgba(250, 244, 232, .86);
  border: 1px solid #bca98f;
  padding: 5px 8px;
  outline: none;
}
.scroll-dialog__custom input:focus {
  border-color: #a43a2e;
  background: #fdf9ef;
}
#scroll-custom-verse {
  width: min(290px, 60vw);
}
#scroll-custom-seal {
  width: 96px;
}
.scroll-dialog__quest-seals {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.scroll-dialog__quest-seals[hidden] {
  display: none;
}
.scroll-dialog__quest-seals-label {
  font-size: 11.5px;
  color: #5b4d3c;
  letter-spacing: .12em;
  margin-right: 2px;
}
.scroll-quest-seal {
  font-family: ${SERIF_FONT};
  font-size: 11.5px;
  letter-spacing: .12em;
  padding: 3px 9px;
  color: #8f2d22;
  background: rgba(250, 244, 232, .88);
  border: 1px solid rgba(164, 58, 46, .42);
  border-radius: 2px;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
.scroll-quest-seal:hover {
  background: rgba(244, 229, 214, .96);
  border-color: rgba(164, 58, 46, .72);
}
.scroll-quest-seal.is-active {
  color: #faf3e4;
  background: #a43a2e;
  border-color: #86291e;
}
.scroll-dialog__status {
  margin-top: 10px;
  font-size: 12.5px;
  letter-spacing: .12em;
  color: #a43a2e;
  min-height: 1.4em;
}
.scroll-dialog__status:empty {
  display: none;
}
#journal-scrolls.journal__sections {
  display: block;
  padding: 20px 0;
}
#journal-scrolls[hidden] {
  display: none !important;
}
.scroll-box__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.scroll-box__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
}
.scroll-box__filter {
  font: inherit;
  font-size: 12px;
  letter-spacing: .12em;
  color: #5b5043;
  background: rgba(247, 240, 226, .72);
  border: 1px solid #c5b69d;
  border-radius: 2px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background-color .16s ease, border-color .16s ease, color .16s ease;
}
.scroll-box__filter:hover,
.scroll-box__filter:focus-visible {
  background: rgba(235, 224, 200, .96);
  border-color: #a43a2e;
}
.scroll-box__filter[aria-pressed="true"] {
  color: #faf3e4;
  background: rgba(164, 58, 46, .88);
  border-color: rgba(138, 42, 32, .95);
}
.scroll-box__count {
  font-size: 12.5px;
  color: #665d50;
  letter-spacing: .12em;
}
.scroll-box__empty {
  color: #817769;
  font-size: 14px;
  line-height: 1.9;
  padding: 12px 0;
}
.scroll-box__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
  gap: 16px;
}
.scroll-card {
  border: 1px solid #c6b79d;
  background: rgba(248, 242, 229, .86);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scroll-card__img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 10;
  object-fit: contain;
  background: #e7dcc4;
  border: 1px solid rgba(110, 94, 72, .2);
}
.scroll-card__title {
  font-size: 11.5px;
  color: #746858;
  letter-spacing: .1em;
}
.scroll-card__time {
  font-size: 11px;
  color: #7e7261;
  letter-spacing: .05em;
  font-variant-numeric: tabular-nums;
  margin-top: -4px;
}
.scroll-card__verse {
  font-size: 13px;
  line-height: 1.65;
  color: #302c27;
  letter-spacing: .06em;
}
.scroll-card__foot {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.scroll-card__seal {
  font-size: 11px;
  color: #a43a2e;
  border: 1px solid rgba(164, 58, 46, .52);
  padding: 1px 6px;
  letter-spacing: .14em;
}
.scroll-card__btns {
  display: flex;
  gap: 6px;
}
.journal .scroll-card__btns button {
  padding: 4px 9px;
  font-size: 12px;
}
@media (max-width: 720px) {
  #scroll-dialog {
    width: calc(100vw - 16px);
    max-height: 92dvh;
    padding: 13px 12px 12px;
    border-radius: 10px;
    overscroll-behavior: contain;
  }
  .scroll-dialog__head {
    padding-bottom: 8px;
  }
  .scroll-dialog__head h2 {
    font-size: 19px;
    margin-top: 3px;
  }
  #scroll-close {
    min-width: 34px;
    min-height: 34px;
    padding: 5px 9px;
  }
  .scroll-dialog__stage {
    margin-top: 10px;
    padding: 6px;
  }
  #scroll-preview-canvas {
    max-height: 29dvh;
  }
  .scroll-dialog__meta {
    margin-top: 8px;
    font-size: 11px;
    gap: 4px 10px;
  }
  .scroll-dialog__cues {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
  }
  .scroll-dialog__custom {
    margin-top: 8px;
    padding-top: 8px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 8px;
  }
  .scroll-dialog__custom label:first-child {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .scroll-dialog__custom label:nth-of-type(2) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .scroll-dialog__custom input {
    font-size: 16px;
    padding: 5px 8px;
    min-width: 0;
  }
  #scroll-custom-verse,
  #scroll-custom-seal {
    width: 100%;
  }
  #scroll-seal-style {
    min-height: 34px;
    padding: 5px 10px;
    white-space: nowrap;
  }
  .scroll-dialog__actions {
    margin-top: 10px;
    padding-top: 10px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  .scroll-dialog__actions button {
    min-height: 36px;
    padding: 6px 8px;
    font-size: 12px;
  }
  #scroll-download-png {
    grid-column: 1 / -1;
  }
  .scroll-box__filter {
    padding: 6px 12px;
    min-height: 34px;
  }
  .journal .scroll-card__btns button {
    min-height: 34px;
    padding: 5px 11px;
  }
}
@media (max-width: 480px) {
  .scroll-box__grid {
    grid-template-columns: 1fr;
  }
}
`;

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const text = String(str || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 20261116;
}

function findDescendant(root, pred) {
  if (!root || !Array.isArray(root.children)) return null;
  for (let i = 0; i < root.children.length; i++) {
    const ch = root.children[i];
    if (!ch) continue;
    if (pred(ch)) return ch;
    const sub = findDescendant(ch, pred);
    if (sub) return sub;
  }
  return null;
}

function removeElement(el) {
  if (!el) return;
  if (typeof el.remove === 'function') {
    el.remove();
  } else if (el.parentNode && Array.isArray(el.parentNode.children)) {
    const idx = el.parentNode.children.indexOf(el);
    if (idx >= 0) el.parentNode.children.splice(idx, 1);
    el.parentNode = null;
  }
}

function insertBeforeSafe(parent, node, refNode) {
  if (!parent || !node) return;
  if (refNode && typeof parent.insertBefore === 'function') {
    parent.insertBefore(node, refNode);
    return;
  }
  if (refNode && Array.isArray(parent.children)) {
    const idx = parent.children.indexOf(refNode);
    if (idx >= 0) {
      node.parentNode = parent;
      parent.children.splice(idx, 0, node);
      return;
    }
  }
  parent.appendChild?.(node);
}

function fallbackCanvas2DContext(cv) {
  return {
    canvas: cv,
    fillStyle: '#f2ead9',
    strokeStyle: '#302c27',
    lineWidth: 1,
    globalAlpha: 1,
    font: '16px serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
}

function createSurfaceCanvas(doc, w, h) {
  const cv = doc?.createElement ? doc.createElement('canvas') : { width: w, height: h };
  cv.width = w;
  cv.height = h;
  if (typeof cv.getContext !== 'function') {
    const ctx = fallbackCanvas2DContext(cv);
    cv.getContext = () => ctx;
  }
  if (typeof cv.toDataURL !== 'function') {
    cv.toDataURL = function (mime = 'image/png') {
      const m = typeof mime === 'string' && mime ? mime : 'image/png';
      return 'data:' + m + ';base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    };
  }
  return cv;
}

function fillLinear(ctx, x0, y0, x1, y1, stops, fallbackColor) {
  if (typeof ctx.createLinearGradient === 'function') {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    if (g && typeof g.addColorStop === 'function') {
      for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      ctx.fillStyle = g;
      return;
    }
  }
  ctx.fillStyle = fallbackColor;
}

function drawXuanPaperFibers(ctx, x, y, w, h, seed, fiberCount, speckCount) {
  const rand = lcg(seed);
  ctx.save?.();
  if (typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }

  for (let i = 0; i < speckCount; i++) {
    const sx = x + rand() * w;
    const sy = y + rand() * h;
    const sr = 0.6 + rand() * 1.3;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(136, 114, 84, 0.055)' : 'rgba(255, 250, 240, 0.09)';
    ctx.fillRect?.(sx, sy, sr, sr);
  }

  ctx.lineWidth = 0.75;
  for (let i = 0; i < fiberCount; i++) {
    const fx = x + rand() * w;
    const fy = y + rand() * h;
    const ang = rand() * Math.PI * 2;
    const len = 5 + rand() * 15;
    const bend = (rand() - 0.5) * 3.2;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(122, 102, 74, 0.08)' : 'rgba(255, 251, 242, 0.14)';
    ctx.beginPath?.();
    ctx.moveTo?.(fx, fy);
    ctx.lineTo?.(fx + Math.cos(ang) * len * 0.5 - Math.sin(ang) * bend, fy + Math.sin(ang) * len * 0.5 + Math.cos(ang) * bend);
    ctx.lineTo?.(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len);
    ctx.stroke?.();
  }
  ctx.restore?.();
}

function drawSilkBrocadePattern(ctx, w, h, color) {
  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.7;
  const step = 36;
  ctx.beginPath?.();
  for (let y = 18; y < h; y += step) {
    for (let x = 18; x < w; x += step) {
      ctx.moveTo?.(x - 6, y);
      ctx.lineTo?.(x, y - 6);
      ctx.lineTo?.(x + 6, y);
      ctx.lineTo?.(x, y + 6);
      ctx.lineTo?.(x - 6, y);
    }
  }
  ctx.stroke?.();
  ctx.restore?.();
}

export function computeExportScale(source, mountMode) {
  const spec = mountMode === 'hanging' ? HANGING_SIZE : HANDSCROLL_SIZE;
  const sw = Number(source?.width) || Number(source?.clientWidth) || 0;
  const sh = Number(source?.height) || Number(source?.clientHeight) || 0;
  if (sw <= 0 || sh <= 0) return 1;
  const cropW = (sw / sh) > (spec.heartW / spec.heartH)
    ? sh * (spec.heartW / spec.heartH)
    : sw;
  return Math.max(1, Math.min(MAX_EXPORT_SCALE, cropW / spec.heartW));
}

function applyBrushStyleToHeart(ctx, dx, dy, dw, dh, styleId, scaleX = 1, scaleY = 1) {
  if (!styleId || styleId === 'qinglv') return;
  if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
  try {
    const sx = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
    const sy = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
    const maxW = Number(ctx.canvas?.width) || Math.ceil((dx + dw) * sx);
    const maxH = Number(ctx.canvas?.height) || Math.ceil((dy + dh) * sy);
    const ix = Math.max(0, Math.floor(dx * sx));
    const iy = Math.max(0, Math.floor(dy * sy));
    const ix2 = Math.min(maxW, Math.ceil((dx + dw) * sx));
    const iy2 = Math.min(maxH, Math.ceil((dy + dh) * sy));
    const iw = Math.max(1, ix2 - ix);
    const ih = Math.max(1, iy2 - iy);
    const img = ctx.getImageData(ix, iy, iw, ih);
    const d = img && img.data;
    if (!d || d.length < 4) return;
    if (styleId === 'qianjiang') {
      // 浅绛淡彩：黄公望富春山居笔意，赭石暖调与淡花青交融
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const lum = 0.27 * r + 0.61 * g + 0.12 * b;
        const paperMix = lum > 175 ? (lum - 175) / 80 : 0;
        const nr = lum * 0.56 + r * 0.44 + 14 + paperMix * 8;
        const ng = lum * 0.58 + g * 0.42 + 6 + paperMix * 4;
        const nb = lum * 0.66 + b * 0.34 - 8 - paperMix * 4;
        d[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
        d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
        d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      }
    } else if (styleId === 'shuimo') {
      // 水墨留白：焦浓重淡清五色松烟墨，高光化入温润宣纸留白
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        let lum = (0.26 * r + 0.62 * g + 0.12 * b) / 255;
        // Soft S-curve ink contrast + generous Xuan-paper highlight leave-blank
        lum = lum < 0.5
          ? 0.5 * Math.pow(lum * 2, 1.16)
          : 1 - 0.5 * Math.pow((1 - lum) * 2, 1.24);
        const inkR = 34 + lum * (243 - 34);
        const inkG = 32 + lum * (236 - 32);
        const inkB = 29 + lum * (219 - 29);
        d[i] = inkR;
        d[i + 1] = inkG;
        d[i + 2] = inkB;
      }
    }
    ctx.putImageData(img, ix, iy);
  } catch {
    // Tainted or mock canvas fallback
  }
}

function drawCoverScene(ctx, source, dx, dy, dw, dh, styleId = 'qinglv', scaleX = 1, scaleY = 1) {
  ctx.save?.();
  ctx.fillStyle = '#d9d2c0';
  ctx.fillRect?.(dx, dy, dw, dh);

  const sw = Number(source?.width) || Number(source?.clientWidth) || dw;
  const sh = Number(source?.height) || Number(source?.clientHeight) || dh;
  if (source && typeof ctx.drawImage === 'function' && sw > 0 && sh > 0) {
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    const srcAspect = sw / sh;
    const dstAspect = dw / dh;
    let sx = 0;
    let sy = 0;
    let sWidth = sw;
    let sHeight = sh;
    if (srcAspect > dstAspect) {
      sWidth = sh * dstAspect;
      sx = (sw - sWidth) * 0.5;
    } else if (srcAspect < dstAspect) {
      sHeight = sw / dstAspect;
      sy = (sh - sHeight) * 0.5;
    }
    try {
      ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
    } catch {
      try { ctx.drawImage(source, dx, dy, dw, dh); } catch {}
    }
  }

  applyBrushStyleToHeart(ctx, dx, dy, dw, dh, styleId, scaleX, scaleY);

  // 画心内缘淡墨晕染与宣纸温润罩色
  if (typeof ctx.createRadialGradient === 'function') {
    const cx = dx + dw * 0.5;
    const cy = dy + dh * 0.5;
    const r0 = Math.min(dw, dh) * 0.36;
    const r1 = Math.hypot(dw, dh) * 0.54;
    const vg = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    if (vg && typeof vg.addColorStop === 'function') {
      vg.addColorStop(0, 'rgba(244, 236, 218, 0)');
      vg.addColorStop(0.78, 'rgba(54, 46, 36, 0.04)');
      vg.addColorStop(1, 'rgba(42, 36, 28, 0.16)');
      ctx.fillStyle = vg;
      ctx.fillRect?.(dx, dy, dw, dh);
    }
  }

  // 隔水乌丝双线画框
  ctx.strokeStyle = 'rgba(58, 48, 38, 0.42)';
  ctx.lineWidth = 1.3;
  ctx.strokeRect?.(dx - 0.5, dy - 0.5, dw + 1, dh + 1);
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect?.(dx - 5.5, dy - 5.5, dw + 11, dh + 11);
  ctx.restore?.();
}

function drawCinnabarSeal(ctx, x, y, size, sealText, paperBg, seed, sealStyle = 'zhuwen') {
  const rawChars = Array.from(String(sealText || '桃源清赏').trim()).slice(0, 4);
  const chars = rawChars.length ? rawChars : Array.from('桃源清赏');
  if (chars.length === 1) chars.push('印');
  else if (chars.length === 3) chars.push('印');
  const isBaiwen = sealStyle === 'baiwen';
  const rand = lcg(seed);

  ctx.save?.();
  if (isBaiwen) {
    // 白文（阴刻）：朱砂满底、宣纸白字，沉厚古朴
    ctx.fillStyle = '#a8382b';
    ctx.fillRect?.(x + 1, y + 1, size - 2, size - 2);
    ctx.strokeStyle = paperBg || '#f1e7d2';
    ctx.lineWidth = Math.max(1.0, size * 0.02);
    ctx.strokeRect?.(x + 4, y + 4, size - 8, size - 8);
  } else {
    // 朱文（阳刻）：印泥微渗底色 + 朱红双边印框
    ctx.fillStyle = 'rgba(168, 56, 43, 0.08)';
    ctx.fillRect?.(x + 1, y + 1, size - 2, size - 2);
    ctx.strokeStyle = '#a8382b';
    ctx.lineWidth = Math.max(1.8, size * 0.038);
    ctx.strokeRect?.(x + 1.5, y + 1.5, size - 3, size - 3);
    ctx.lineWidth = Math.max(0.8, size * 0.015);
    ctx.strokeRect?.(x + 5, y + 5, size - 10, size - 10);
  }

  ctx.fillStyle = isBaiwen ? (paperBg || '#f4ecda') : '#a8382b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (chars.length === 2) {
    // 二字闲章：竖列居中舒展排布
    const fontSize = Math.round(size * 0.36);
    ctx.font = '600 ' + fontSize + 'px ' + SERIF_FONT;
    ctx.fillText?.(chars[0], x + size * 0.50, y + size * 0.31);
    ctx.fillText?.(chars[1], x + size * 0.50, y + size * 0.70);
  } else {
    // 2x2 古印排字（右起竖读：右上0、右下1、左上2、左下3）
    const fontSize = Math.round(size * 0.31);
    ctx.font = '600 ' + fontSize + 'px ' + SERIF_FONT;
    const cRight = x + size * 0.70;
    const cLeft = x + size * 0.30;
    const rTop = y + size * 0.31;
    const rBot = y + size * 0.70;
    ctx.fillText?.(chars[0], cRight, rTop);
    ctx.fillText?.(chars[1], cRight, rBot);
    ctx.fillText?.(chars[2], cLeft, rTop);
    ctx.fillText?.(chars[3], cLeft, rBot);
  }

  // 金石残破肌理（细微纸色飞白缺刻，赋予手钤印泥质感）
  ctx.fillStyle = paperBg || '#f1e7d2';
  for (let i = 0; i < 14; i++) {
    const edge = i % 4;
    let nx = x + rand() * size;
    let ny = y + rand() * size;
    if (edge === 0) ny = y + rand() * 3.5;
    else if (edge === 1) ny = y + size - rand() * 3.5;
    else if (edge === 2) nx = x + rand() * 3.5;
    else nx = x + size - rand() * 3.5;
    ctx.fillRect?.(nx, ny, 1.2 + rand() * 1.8, 1.0 + rand() * 1.5);
  }
  ctx.restore?.();
}

function drawHandscrollMount(ctx, source, meta, scaleX = 1, scaleY = 1) {
  const { width: W, height: H, heartX, heartY, heartW, heartH } = HANDSCROLL_SIZE;
  const seed = hashSeed(meta.title + '|' + meta.verse + '|handscroll');

  ctx.clearRect?.(0, 0, W, H);
  fillLinear(ctx, 0, 0, W, H, [
    [0, '#efe5cf'],
    [0.52, '#ebe0c7'],
    [1, '#e5d8bc']
  ], '#efe5cf');
  ctx.fillRect?.(0, 0, W, H);
  drawSilkBrocadePattern(ctx, W, H, 'rgba(110, 92, 66, 0.045)');

  // 外绫边与内宣纸隔水
  const matX = 32;
  const matY = 24;
  const matW = W - 64;
  const matH = H - 48;
  fillLinear(ctx, matX, matY, matX, matY + matH, [
    [0, '#f4ecda'],
    [1, '#ede1c8']
  ], '#f2ead9');
  ctx.fillRect?.(matX, matY, matW, matH);
  drawXuanPaperFibers(ctx, matX, matY, matW, matH, seed, 88, 240);

  ctx.strokeStyle = 'rgba(92, 76, 56, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect?.(matX + 0.5, matY + 0.5, matW - 1, matH - 1);
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.2)';
  ctx.strokeRect?.(matX + 6.5, matY + 6.5, matW - 13, matH - 13);

  // 画心
  drawCoverScene(ctx, source, heartX, heartY, heartW, heartH, meta.style, scaleX, scaleY);

  // 跋尾隔水横栏
  const colY = heartY + heartH + 18;
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.28)';
  ctx.lineWidth = 0.9;
  ctx.beginPath?.();
  ctx.moveTo?.(heartX, colY);
  ctx.lineTo?.(heartX + heartW, colY);
  ctx.stroke?.();

  // 题识纪年地名小引 + 陶诗题句
  ctx.save?.();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // 朱砂引首小印记
  ctx.strokeStyle = 'rgba(168, 56, 43, 0.78)';
  ctx.lineWidth = 1.1;
  ctx.strokeRect?.(heartX + 2, colY + 20, 12, 22);
  ctx.fillStyle = '#a8382b';
  ctx.font = '10px ' + SERIF_FONT;
  ctx.textAlign = 'center';
  ctx.fillText?.('记', heartX + 8, colY + 31);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#6a5946';
  ctx.font = '15px ' + SERIF_FONT;
  ctx.fillText?.(meta.title, heartX + 24, colY + 31);

  const sealSize = 68;
  const timeStamp = meta.modernTime
    ? (meta.solarTerm ? `${meta.modernTime} · ${meta.solarTerm}` : meta.modernTime)
    : (meta.solarTerm || '');
  if (timeStamp) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7c6b56';
    ctx.font = '13px ' + SERIF_FONT;
    ctx.fillText?.(timeStamp, heartX + heartW - sealSize - 22, colY + 31);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#2b2621';
  ctx.font = '23px ' + SERIF_FONT;
  ctx.fillText?.(meta.verse, heartX + 2, colY + 74);

  if (meta.solarTerm && meta.solarWhisper) {
    ctx.fillStyle = '#7c6a55';
    ctx.font = '13.5px ' + SERIF_FONT;
    ctx.fillText?.(`时维${meta.solarTerm} · ${meta.solarWhisper}`, heartX + 2, colY + 108);
  }
  ctx.restore?.();

  // 右下朱文/白文方印
  drawCinnabarSeal(ctx, heartX + heartW - sealSize - 4, colY + 22, sealSize, meta.seal, '#efe4cd', seed ^ 0x5a3c91, meta.sealStyle);
}

function splitVerticalClauses(verse) {
  const raw = String(verse || '').trim();
  const parts = raw
    .split(/[，。；！？、]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function drawVerticalString(ctx, text, x, startY, stepY, maxY) {
  const chars = Array.from(String(text || ''));
  let cy = startY;
  for (let i = 0; i < chars.length; i++) {
    if (maxY && cy > maxY) break;
    const ch = chars[i];
    if (ch === '·' || ch === ' ') {
      ctx.fillText?.('·', x, cy);
      cy += stepY * 0.72;
    } else {
      ctx.fillText?.(ch, x, cy);
      cy += stepY;
    }
  }
  return cy;
}

function drawHangingMount(ctx, source, meta, scaleX = 1, scaleY = 1) {
  const { width: W, height: H, heartX, heartY, heartW, heartH } = HANGING_SIZE;
  const seed = hashSeed(meta.title + '|' + meta.verse + '|hanging');

  ctx.clearRect?.(0, 0, W, H);
  // 宋锦青缃外装池
  fillLinear(ctx, 0, 0, W, H, [
    [0, '#dfd7c3'],
    [0.55, '#dad1bc'],
    [1, '#d2c8b0']
  ], '#dfd7c3');
  ctx.fillRect?.(0, 0, W, H);
  drawSilkBrocadePattern(ctx, W, H, 'rgba(84, 80, 64, 0.052)');

  // 宣纸内绫镶边
  const matX = 38;
  const matY = 34;
  const matW = W - 76;
  const matH = H - 68;
  fillLinear(ctx, matX, matY, matX, matY + matH, [
    [0, '#f4ecda'],
    [1, '#ece0c8']
  ], '#f4ecda');
  ctx.fillRect?.(matX, matY, matW, matH);
  drawXuanPaperFibers(ctx, matX, matY, matW, matH, seed, 96, 260);

  // 宋锦隔水边线
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.35)';
  ctx.lineWidth = 1.1;
  ctx.strokeRect?.(matX + 0.5, matY + 0.5, matW - 1, matH - 1);
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.2)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect?.(matX + 7.5, matY + 7.5, matW - 15, matH - 15);

  // 左幅画心 (940 x 640)
  drawCoverScene(ctx, source, heartX, heartY, heartW, heartH, meta.style, scaleX, scaleY);

  // 画心与右题竖跋之间的乌丝界栏
  const dividerX = heartX + heartW + 24;
  ctx.strokeStyle = 'rgba(92, 76, 56, 0.28)';
  ctx.lineWidth = 0.9;
  ctx.beginPath?.();
  ctx.moveTo?.(dividerX, heartY);
  ctx.lineTo?.(dividerX, heartY + heartH);
  ctx.stroke?.();

  // 右题竖跋（自右向左分列：最右列为纪游题头，其左诸列为陶公诗文竖排，列底钤朱文印）
  ctx.save?.();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const rightHeaderX = W - 76;
  ctx.fillStyle = '#6c5a47';
  ctx.font = '14px ' + SERIF_FONT;
  drawVerticalString(ctx, meta.title, rightHeaderX, heartY + 14, 21, heartY + heartH - 88);

  const clauses = splitVerticalClauses(meta.verse);
  ctx.fillStyle = '#28231e';
  ctx.font = '21px ' + SERIF_FONT;

  const colStartX = rightHeaderX - 40;
  const colSpacing = 32;
  let lastColX = colStartX;
  let lastEndY = heartY + 18;
  const maxCols = Math.min(clauses.length, 4);
  for (let c = 0; c < maxCols; c++) {
    const cx = colStartX - c * colSpacing;
    lastColX = cx;
    lastEndY = drawVerticalString(ctx, clauses[c], cx, heartY + 18 + (c % 2) * 8, 28, heartY + heartH - 84);
  }
  ctx.restore?.();

  const sealSize = 60;
  const sealX = Math.max(dividerX + 16, Math.min(W - 64 - sealSize, lastColX - sealSize * 0.5));
  const sealY = Math.min(heartY + heartH - sealSize - 4, Math.max(lastEndY + 18, heartY + heartH - sealSize - 24));
  drawCinnabarSeal(ctx, sealX, sealY, sealSize, meta.seal, '#efe5cf', seed ^ 0x71d24b, meta.sealStyle);

  const hangingTimeStamp = meta.modernTime
    ? (meta.solarTerm ? `${meta.modernTime} · ${meta.solarTerm}` : meta.modernTime)
    : (meta.solarTerm || '');
  if (hangingTimeStamp || (meta.solarTerm && meta.solarWhisper)) {
    ctx.save?.();
    ctx.textBaseline = 'middle';
    ctx.font = '13px ' + SERIF_FONT;
    if (meta.solarTerm && meta.solarWhisper) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7c6a55';
      ctx.fillText?.(`时维${meta.solarTerm} · ${meta.solarWhisper}`, heartX, heartY + heartH + 34);
    }
    if (hangingTimeStamp) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#7c6b56';
      ctx.fillText?.(hangingTimeStamp, W - 64, heartY + heartH + 34);
    }
    ctx.restore?.();
  }
}

export function createScrollStudio({
  canvas,
  player,
  field,
  camera,
  riverSkiff,
  act3Finale,
  journal,
  map,
  sky,
  getPhenology,
  getWorldClock,
  getTravelerGuide,
  getGodFlight,
  getQuestSystem = null,
  getSceneContext,
  sceneContext,
  renderSceneNow,
  world,
  doc = globalThis.document,
  win = globalThis.window,
  storage = globalThis.localStorage,
  idbFactory = win?.indexedDB ?? globalThis.indexedDB
} = {}) {
  let disposed = false;
  let currentMount = 'handscroll';
  let currentStyleIdx = 0;
  let currentVerseIdx = 0;
  let customVerse = '';
  let customSeal = '';
  let currentSealStyle = 'zhuwen';
  let captureCount = 0;
  let stitchCount = 0;
  let enterWorldCount = 0;
  let saveSeq = 0;
  let storageOK = true;
  let wasLocked = false;
  let returnFocus = null;
  let returnToRoaming = false;
  let snapshotCanvas = null;
  let snapshotMeta = null;
  let mountedCanvas = null;
  let currentQueue = null;
  let currentQueuePos = 0;
  const recentColophonIds = [];

  const originalMemCache = new Map();
  const originalPendingSaves = new Map();
  const pendingRevokeTimers = new Set();
  let originalDbPromise = null;
  let openedDbInstance = null;

  function openOriginalDb() {
    if (disposed || !idbFactory || typeof idbFactory.open !== 'function') {
      return Promise.resolve(null);
    }
    if (originalDbPromise) return originalDbPromise;
    originalDbPromise = new Promise(resolve => {
      try {
        const req = idbFactory.open(ORIGINAL_DB_NAME, ORIGINAL_DB_VERSION);
        if (!req) {
          originalDbPromise = null;
          resolve(null);
          return;
        }
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (db && !db.objectStoreNames?.contains?.(ORIGINAL_STORE_NAME)) {
              db.createObjectStore(ORIGINAL_STORE_NAME, { keyPath: 'id' });
            }
          } catch {}
        };
        req.onsuccess = () => {
          const db = req.result || null;
          if (!db || disposed) {
            try { db?.close?.(); } catch {}
            originalDbPromise = null;
            openedDbInstance = null;
            resolve(null);
            return;
          }
          openedDbInstance = db;
          db.onversionchange = () => {
            try { db.close?.(); } catch {}
            if (openedDbInstance === db) openedDbInstance = null;
            originalDbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          originalDbPromise = null;
          resolve(null);
        };
        req.onblocked = () => {
          originalDbPromise = null;
          resolve(null);
        };
      } catch {
        originalDbPromise = null;
        resolve(null);
      }
    });
    return originalDbPromise;
  }

  function closeOriginalDb() {
    const db = openedDbInstance;
    openedDbInstance = null;
    originalDbPromise = null;
    try { db?.close?.(); } catch {}
  }

  async function putOriginalRecord(record) {
    const db = await openOriginalDb();
    if (!db || disposed) return false;
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ORIGINAL_STORE_NAME);
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
        tx.onabort = () => finish(false);
        const req = store.put(record);
        if (req) req.onerror = () => finish(false);
      } catch {
        finish(false);
      }
    });
  }

  async function getOriginalRecord(id) {
    if (!id) return null;
    const db = await openOriginalDb();
    if (!db || disposed) return null;
    return new Promise(resolve => {
      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        resolve(val || null);
      };
      try {
        const tx = db.transaction(ORIGINAL_STORE_NAME, 'readonly');
        const store = tx.objectStore(ORIGINAL_STORE_NAME);
        const req = store.get(id);
        if (!req) {
          finish(null);
          return;
        }
        req.onsuccess = () => finish(req.result || null);
        req.onerror = () => finish(null);
        tx.onerror = () => finish(null);
        tx.onabort = () => finish(null);
      } catch {
        finish(null);
      }
    });
  }

  async function deleteOriginalRecord(id) {
    if (!id) return false;
    const db = await openOriginalDb();
    if (!db) return false;
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ORIGINAL_STORE_NAME);
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
        tx.onabort = () => finish(false);
        const req = store.delete(id);
        if (req) req.onerror = () => finish(false);
      } catch {
        finish(false);
      }
    });
  }

  async function clearOriginalRecords() {
    const db = await openOriginalDb();
    if (!db) return false;
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ORIGINAL_STORE_NAME);
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
        tx.onabort = () => finish(false);
        const req = store.clear();
        if (req) req.onerror = () => finish(false);
      } catch {
        finish(false);
      }
    });
  }

  async function pruneOriginalRecords(validIds) {
    const db = await openOriginalDb();
    if (!db) return false;
    const keep = validIds instanceof Set ? validIds : new Set(validIds);
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ORIGINAL_STORE_NAME);
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
        tx.onabort = () => finish(false);
        if (typeof store.getAllKeys === 'function') {
          const req = store.getAllKeys();
          req.onsuccess = () => {
            const keys = Array.isArray(req.result) ? req.result : [];
            for (let i = 0; i < keys.length; i++) {
              if (!keep.has(keys[i])) {
                try { store.delete(keys[i]); } catch {}
              }
            }
          };
          req.onerror = () => finish(false);
        } else if (typeof store.openCursor === 'function') {
          const req = store.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            if (!keep.has(cursor.key)) {
              try { cursor.delete(); } catch {}
            }
            cursor.continue();
          };
          req.onerror = () => finish(false);
        } else {
          finish(false);
        }
      } catch {
        finish(false);
      }
    });
  }

  function pruneOrphanedOriginals() {
    const validIds = new Set(savedScrolls.map(s => s.id));
    for (const key of originalMemCache.keys()) {
      if (!validIds.has(key)) originalMemCache.delete(key);
    }
    for (const key of originalPendingSaves.keys()) {
      if (!validIds.has(key)) originalPendingSaves.delete(key);
    }
    void pruneOriginalRecords(validIds);
  }

  function resolveSceneContext() {
    try {
      return typeof getSceneContext === 'function' ? getSceneContext() : sceneContext;
    } catch {
      return sceneContext || null;
    }
  }

  function rememberColophon(colophon) {
    if (!colophon) return;
    const keys = [];
    if (typeof colophon.id === 'string' && colophon.id) keys.push(colophon.id);
    if (typeof colophon.verse === 'string' && colophon.verse) keys.push(colophon.verse);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const idx = recentColophonIds.indexOf(k);
      if (idx >= 0) recentColophonIds.splice(idx, 1);
      recentColophonIds.unshift(k);
    }
    if (recentColophonIds.length > 40) recentColophonIds.length = 40;
  }

  function loadSavedScrolls() {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.dataUrl === 'string')
        .slice(0, MAX_SAVED_SCROLLS)
        .map(item => {
          const out = {
            id: String(item.id),
            title: String(item.title || '桃源行纪'),
            verse: String(item.verse || CLASSICAL_COLOPHONS[0].verse),
            seal: String(item.seal || CLASSICAL_COLOPHONS[0].seal),
            sealStyle: item.sealStyle === 'baiwen' ? 'baiwen' : 'zhuwen',
            mount: item.mount === 'hanging' ? 'hanging' : 'handscroll',
            style: BRUSH_STYLES.some(s => s.id === item.style) ? item.style : 'qinglv',
            region: String(item.region || '桃花源'),
            timeLabel: String(item.timeLabel || '晴昼'),
            createdAt: Number(item.createdAt) || 0,
            dataUrl: String(item.dataUrl)
          };
          if (item.hasOriginal === true) {
            out.hasOriginal = true;
          }
          if (Number.isFinite(Number(item.originalWidth)) && Number(item.originalWidth) > 0) {
            out.originalWidth = Math.round(Number(item.originalWidth));
          }
          if (Number.isFinite(Number(item.originalHeight)) && Number(item.originalHeight) > 0) {
            out.originalHeight = Math.round(Number(item.originalHeight));
          }
          if (typeof item.originalMime === 'string' && item.originalMime.trim()) {
            out.originalMime = item.originalMime.trim();
          }
          if (typeof item.modernTime === 'string' && item.modernTime.trim()) {
            out.modernTime = item.modernTime.trim();
          }
          if (typeof item.solarTerm === 'string' && item.solarTerm.trim()) {
            out.solarTerm = item.solarTerm.trim();
          }
          if (typeof item.solarWhisper === 'string' && item.solarWhisper.trim()) {
            out.solarWhisper = item.solarWhisper.trim();
          }
          if (item.phenology === 'spring' || item.phenology === 'summer' || item.phenology === 'autumn' || item.phenology === 'winter') {
            out.phenology = item.phenology;
          }
          if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z))) {
            out.x = Number(item.x);
            out.z = Number(item.z);
          }
          if (Number.isFinite(Number(item.yaw))) {
            out.yaw = Number(item.yaw);
          }
          return out;
        });
    } catch {
      storageOK = false;
      return [];
    }
  }

  let savedScrolls = loadSavedScrolls();
  for (let i = 0; i < savedScrolls.length; i++) {
    rememberColophon({ verse: savedScrolls[i].verse });
  }

  function persistScrolls() {
    if (!storage || typeof storage.setItem !== 'function') {
      storageOK = false;
      return false;
    }
    const prevCount = savedScrolls.length;
    for (let cap = Math.min(savedScrolls.length, MAX_SAVED_SCROLLS); cap >= 1; cap--) {
      try {
        const trimmed = savedScrolls.slice(0, cap);
        storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        savedScrolls = trimmed;
        storageOK = true;
        if (trimmed.length < prevCount) {
          pruneOrphanedOriginals();
        }
        return true;
      } catch {
        // 若空间不足则逐幅退让旧卷，确保新卷尽量可存
      }
    }
    if (savedScrolls.length === 0) {
      try {
        storage.setItem(STORAGE_KEY, '[]');
        storageOK = true;
        return true;
      } catch {
        storageOK = false;
        return false;
      }
    }
    storageOK = false;
    return false;
  }

  function resolvePhenologyInfo() {
    let raw = null;
    try { raw = typeof getPhenology === 'function' ? getPhenology() : getPhenology; } catch {}
    if (!raw) return { id: 'spring', label: '春深' };
    if (typeof raw === 'string') {
      const id = PHENOLOGY_SHORT[raw] ? raw : 'spring';
      return { id, label: PHENOLOGY_SHORT[raw] || raw };
    }
    if (typeof raw === 'object') {
      const stats = typeof raw.getStats === 'function' ? raw.getStats() : raw;
      const id = stats?.phenologyId || stats?.id || stats?.mode || 'spring';
      if (PHENOLOGY_SHORT[id]) return { id, label: PHENOLOGY_SHORT[id] };
      if (typeof stats?.short === 'string' && stats.short) return { id: String(id), label: stats.short };
    }
    return { id: 'spring', label: '春深' };
  }

  function resolveSkyInfo() {
    const timeId = sky?.timeId || sky?.getStats?.()?.time || 'day';
    const weatherId = sky?.weatherId || sky?.getStats?.()?.weather || 'clear';
    const wLabel = WEATHER_PREFIX[weatherId] || '晴';
    const tLabel = TIME_SUFFIX[timeId] || '昼';
    return {
      timeId,
      weatherId,
      timeLabel: wLabel + tLabel
    };
  }

  function resolveClockInfo() {
    let modernTime = '';
    let solarTerm = '';
    let solarWhisper = '';
    try {
      const wc = typeof getWorldClock === 'function' ? getWorldClock() : getWorldClock;
      const st = wc?.getState?.();
      if (typeof st?.modernText === 'string' && st.modernText.trim()) modernTime = st.modernText.trim();
      if (typeof st?.solarTerm === 'string' && st.solarTerm.trim()) solarTerm = st.solarTerm.trim();
      if (typeof st?.solarWhisper === 'string' && st.solarWhisper.trim()) solarWhisper = st.solarWhisper.trim();
    } catch {}
    if (!modernTime) {
      const elText = doc?.getElementById?.('sky-modern-time')?.textContent;
      if (typeof elText === 'string' && elText.trim()) modernTime = elText.trim();
    }
    return { modernTime, solarTerm, solarWhisper };
  }

  const _camDir = { x: 0, y: 0, z: -1, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, applyQuaternion(q) { const x = this.x, y = this.y, z = this.z; const qx = q.x, qy = q.y, qz = q.z, qw = q.w; const ix = qw * x + qy * z - qz * y; const iy = qw * y + qz * x - qx * z; const iz = qw * z + qx * y - qy * x; const iw = -qx * x - qy * y - qz * z; this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy; this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz; this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx; return this; } };

  function getActiveViewPose() {
    const detached = Boolean(getTravelerGuide?.()?.cruiseActive || getGodFlight?.()?.active);
    if (detached && camera?.position && Number.isFinite(camera.position.x) && Number.isFinite(camera.position.z)) {
      let yaw = Number.isFinite(camera.rotation?.y) ? camera.rotation.y : 0;
      if (camera.quaternion && Number.isFinite(camera.quaternion.w)) {
        _camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        if (Math.hypot(_camDir.x, _camDir.z) > 1e-4) {
          yaw = Math.atan2(-_camDir.x, -_camDir.z);
        }
      }
      return {
        x: camera.position.x,
        z: camera.position.z,
        yaw,
        detached: true
      };
    }
    return {
      x: Number(player?.state?.x),
      z: Number(player?.state?.z),
      yaw: Number(player?.state?.yaw),
      detached: false
    };
  }

  function matchRegionAt(px, pz) {
    return resolveExpandedRegionAt(px, pz, world, resolveSceneContext());
  }

  function resolveRegion() {
    const pose = getActiveViewPose();
    if (pose.detached) {
      const camRegion = matchRegionAt(pose.x, pose.z);
      if (camRegion) return camRegion;
    }

    const fromMap = map?.getStats?.()?.region;
    if (typeof fromMap === 'string' && fromMap.trim()) return fromMap.trim();

    const miniText = doc?.getElementById?.('minimap-region')?.textContent;
    if (typeof miniText === 'string' && miniText.trim()) return miniText.trim();

    const fallbackRegion = matchRegionAt(pose.x, pose.z);
    if (fallbackRegion) return fallbackRegion;
    return '桃花源';
  }

  function selectContextualQueue(meta, { recordPick = true } = {}) {
    const sceneProfile = meta?.sceneProfile || analyzeScrollScene({
      pose: getActiveViewPose(),
      camera,
      player,
      field,
      world,
      region: meta?.region || resolveRegion(),
      sky,
      skyInfo: meta?.skyInfo || resolveSkyInfo(),
      phenology: meta?.phenology || resolvePhenologyInfo(),
      clockInfo: meta || resolveClockInfo(),
      riverSkiff,
      godFlight: getGodFlight?.(),
      sceneContext: resolveSceneContext()
    });
    const seed =
      Math.floor((meta?.x || 0) / 4) * 31 +
      Math.floor((meta?.z || 0) / 4) * 17 +
      Math.floor(((meta?.yaw || 0) + Math.PI) * 2) +
      captureCount;
    const queue = buildScrollColophonQueue(sceneProfile, {
      recentIds: recentColophonIds,
      savedVerses: savedScrolls.map(s => s.verse),
      seed,
      includeComposed: true,
      composedLimit: 5
    });
    currentQueue = queue;
    currentQueuePos = 0;
    const top = queue.items[0] || CLASSICAL_COLOPHONS[0];
    currentVerseIdx = Number.isInteger(top?.libraryIndex) ? top.libraryIndex : 0;
    if (recordPick) rememberColophon(top);
    return queue;
  }

  function buildSceneMeta(verseIndex = currentVerseIdx, mountMode = currentMount, baseMeta = null, styleOverride = null, colophonOverride = null) {
    const phen = baseMeta?.phenology || resolvePhenologyInfo();
    const skyInfo = baseMeta?.skyInfo || resolveSkyInfo();
    const region = baseMeta?.region || resolveRegion();
    const clockInfo = (baseMeta?.modernTime !== undefined || baseMeta?.solarTerm !== undefined)
      ? {
          modernTime: baseMeta?.modernTime || '',
          solarTerm: baseMeta?.solarTerm || '',
          solarWhisper: baseMeta?.solarWhisper || ''
        }
      : resolveClockInfo();
    const modernTime = clockInfo.modernTime;
    const solarTerm = clockInfo.solarTerm;
    const solarWhisper = clockInfo.solarWhisper;
    const col = colophonOverride || CLASSICAL_COLOPHONS[((verseIndex % CLASSICAL_COLOPHONS.length) + CLASSICAL_COLOPHONS.length) % CLASSICAL_COLOPHONS.length];
    const mount = mountMode === 'hanging' ? 'hanging' : 'handscroll';
    const styleSpec = styleOverride
      ? (BRUSH_STYLES.find(s => s.id === styleOverride) || BRUSH_STYLES[0])
      : BRUSH_STYLES[currentStyleIdx % BRUSH_STYLES.length];
    const verseText = customVerse ? customVerse : col.verse;
    const sealText = customSeal ? customSeal : col.seal;
    return {
      phenology: phen,
      skyInfo,
      region,
      timeLabel: skyInfo.timeLabel,
      modernTime,
      solarTerm,
      solarWhisper,
      mount,
      style: styleSpec.id,
      styleLabel: styleSpec.name,
      mountLabel: (mount === 'hanging' ? '立轴 · 宋锦装池' : '横卷 · 宣纸绫裱') + ' · ' + styleSpec.name,
      title: '桃源行纪 · ' + phen.label + ' · ' + skyInfo.timeLabel + ' · ' + region,
      verse: verseText,
      seal: sealText,
      sealStyle: currentSealStyle,
      colophonId: col.id || ''
    };
  }

  function captureRawSnapshot() {
    renderSceneNow?.();
    const sw = Math.max(1, Number(canvas?.width) || Number(canvas?.clientWidth) || 1280);
    const sh = Math.max(1, Number(canvas?.height) || Number(canvas?.clientHeight) || 720);
    if (!snapshotCanvas) snapshotCanvas = createSurfaceCanvas(doc, sw, sh);
    if (snapshotCanvas.width !== sw || snapshotCanvas.height !== sh) {
      snapshotCanvas.width = sw;
      snapshotCanvas.height = sh;
    }
    const sctx = snapshotCanvas.getContext?.('2d');
    if (sctx && canvas) {
      sctx.clearRect?.(0, 0, sw, sh);
      try { sctx.drawImage?.(canvas, 0, 0, sw, sh); } catch {}
    }
    const phenology = resolvePhenologyInfo();
    const skyInfo = resolveSkyInfo();
    const region = resolveRegion();
    const clockInfo = resolveClockInfo();
    const pose = getActiveViewPose();
    const px = pose.x;
    const pz = pose.z;
    const pyaw = pose.yaw;
    const sceneProfile = analyzeScrollScene({
      pose,
      camera,
      player,
      field,
      world,
      region,
      sky,
      skyInfo,
      phenology,
      clockInfo,
      riverSkiff,
      godFlight: getGodFlight?.(),
      sceneContext: resolveSceneContext()
    });
    snapshotMeta = {
      phenology,
      skyInfo,
      region,
      modernTime: clockInfo.modernTime,
      solarTerm: clockInfo.solarTerm,
      solarWhisper: clockInfo.solarWhisper,
      sceneProfile,
      x: Number.isFinite(px) ? Math.round(px * 10) / 10 : null,
      z: Number.isFinite(pz) ? Math.round(pz * 10) / 10 : null,
      yaw: Number.isFinite(pyaw) ? Math.round(pyaw * 1000) / 1000 : 0
    };
    captureCount++;
    return snapshotCanvas;
  }

  function renderMountedScroll(sourceCanvas, meta, targetCanvas = null, scale = 1) {
    const spec = meta.mount === 'hanging' ? HANGING_SIZE : HANDSCROLL_SIZE;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const outW = Math.max(1, Math.round(spec.width * safeScale));
    const outH = Math.max(1, Math.round(spec.height * safeScale));
    const out = targetCanvas || createSurfaceCanvas(doc, outW, outH);
    if (out.width !== outW || out.height !== outH) {
      out.width = outW;
      out.height = outH;
    }
    const scaleX = outW / spec.width;
    const scaleY = outH / spec.height;
    const ctx = out.getContext?.('2d') || fallbackCanvas2DContext(out);
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.clearRect?.(0, 0, outW, outH);
    ctx.save?.();
    if (scaleX !== 1 || scaleY !== 1) {
      ctx.scale?.(scaleX, scaleY);
    }
    if (meta.mount === 'hanging') {
      drawHangingMount(ctx, sourceCanvas, meta, scaleX, scaleY);
    } else {
      drawHandscrollMount(ctx, sourceCanvas, meta, scaleX, scaleY);
    }
    ctx.restore?.();
    return out;
  }

  function renderOriginalMountedScroll(sourceCanvas, meta) {
    const scale = computeExportScale(sourceCanvas, meta.mount);
    const out = renderMountedScroll(sourceCanvas, meta, null, scale);
    return {
      canvas: out,
      width: Number(out.width) || 0,
      height: Number(out.height) || 0,
      scale
    };
  }

  function captureScrollDataUrl(opts = {}) {
    const modeArg = typeof opts === 'string' ? opts : opts?.mode;
    const mode = modeArg === 'hanging' ? 'hanging' : (modeArg === 'handscroll' ? 'handscroll' : currentMount);
    const useCached = Boolean(typeof opts === 'object' && opts?.useCachedFrame && snapshotCanvas);
    const src = useCached ? snapshotCanvas : captureRawSnapshot();

    let vIdx = currentVerseIdx;
    let pickedColophon = null;
    if (Number.isInteger(opts?.verseIndex)) {
      vIdx = opts.verseIndex;
    } else {
      const queue = (useCached && currentQueue?.items?.length) ? currentQueue : selectContextualQueue(snapshotMeta, { recordPick: true });
      pickedColophon = queue.items[0] || null;
      vIdx = Number.isInteger(pickedColophon?.libraryIndex) ? pickedColophon.libraryIndex : 0;
    }
    const meta = buildSceneMeta(vIdx, mode, snapshotMeta, typeof opts === 'object' ? opts?.style : null, pickedColophon);
    if (typeof opts?.verse === 'string' && opts.verse) meta.verse = opts.verse;
    if (typeof opts?.seal === 'string' && opts.seal) meta.seal = opts.seal;
    if (typeof opts?.title === 'string' && opts.title) meta.title = opts.title;

    const spec = mode === 'hanging' ? HANGING_SIZE : HANDSCROLL_SIZE;
    const scale = Number.isFinite(opts?.scale) && opts.scale > 0 ? opts.scale : computeExportScale(src, mode);
    let renderTarget;
    let tempCanvas = null;
    if (scale === 1) {
      if (!mountedCanvas) {
        mountedCanvas = createSurfaceCanvas(doc, spec.width, spec.height);
      }
      renderTarget = mountedCanvas;
    } else {
      tempCanvas = createSurfaceCanvas(doc, Math.round(spec.width * scale), Math.round(spec.height * scale));
      renderTarget = tempCanvas;
    }
    renderMountedScroll(src, meta, renderTarget, scale);

    let exportCanvas = renderTarget;
    let scaledCanvas = null;
    const targetW = Number(opts?.width);
    if (Number.isFinite(targetW) && targetW > 0 && targetW !== renderTarget.width) {
      const targetH = Math.max(1, Math.round((targetW * renderTarget.height) / renderTarget.width));
      scaledCanvas = createSurfaceCanvas(doc, targetW, targetH);
      const sctx = scaledCanvas.getContext?.('2d');
      if (sctx) {
        if ('imageSmoothingEnabled' in sctx) sctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in sctx) sctx.imageSmoothingQuality = 'high';
        try { sctx.drawImage?.(renderTarget, 0, 0, targetW, targetH); } catch {}
      }
      exportCanvas = scaledCanvas;
    }

    const mimeType = typeof opts?.mimeType === 'string' ? opts.mimeType : 'image/png';
    const quality = typeof opts?.quality === 'number' ? opts.quality : undefined;
    const outUrl = exportCanvas.toDataURL(mimeType, quality);
    if (scaledCanvas) {
      scaledCanvas.width = 0;
      scaledCanvas.height = 0;
    }
    if (tempCanvas) {
      tempCanvas.width = 0;
      tempCanvas.height = 0;
    }
    return outUrl;
  }

  // ---- DOM 构建：顶部「丹青 O」按钮、样式注入、画卷弹窗与游记「画匣」分页 ----
  let styleEl = null;
  let openBtn = null;
  let dialogEl = null;
  let dialogTitleEl = null;
  let previewCanvas = null;
  let metaTitleEl = null;
  let metaSealEl = null;
  let sceneCuesEl = null;
  let mountBtn = null;
  let styleBtn = null;
  let verseBtn = null;
  let saveBtn = null;
  let downloadBtn = null;
  let closeBtn = null;
  let statusEl = null;
  let customVerseInput = null;
  let customSealInput = null;
  let sealStyleBtn = null;
  let questSealsRow = null;

  function getAvailableQuestSeals() {
    const qs = typeof getQuestSystem === 'function' ? getQuestSystem() : getQuestSystem;
    const raw = qs?.getEarnedSeals?.();
    const seen = new Set();
    const out = [];
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        const seal = String(item?.seal || '').trim().slice(0, 4);
        if (!seal || seen.has(seal)) continue;
        seen.add(seal);
        out.push({
          questId: String(item.questId || ''),
          seal,
          title: String(item.title || seal)
        });
      }
    }
    const mapStats = map?.getStats?.();
    const wildsTotal = (wildsEggsCfg.sites || []).length;
    if (wildsTotal > 0 && Number(mapStats?.wildsEggsFound) >= wildsTotal && !seen.has('山野秘藏')) {
      seen.add('山野秘藏');
      out.push({
        questId: 'wilds-seven-wonders',
        seal: '山野秘藏',
        title: '山野七奇尽览 · 桃源秘藏藏书印'
      });
    }
    return out;
  }

  function syncQuestSealPills() {
    if (!questSealsRow?.children) return;
    for (let i = 0; i < questSealsRow.children.length; i++) {
      const btn = questSealsRow.children[i];
      const val = btn?.dataset?.seal;
      if (!val) continue;
      const active = customSeal === val;
      btn.classList?.toggle?.('is-active', active);
      btn.setAttribute?.('aria-pressed', String(active));
    }
  }

  function refreshQuestSeals() {
    if (!questSealsRow || !doc?.createElement) return;
    const seals = getAvailableQuestSeals();
    if (typeof questSealsRow.replaceChildren === 'function') {
      questSealsRow.replaceChildren();
    } else if (Array.isArray(questSealsRow.children)) {
      questSealsRow.children.length = 0;
    }
    if (!seals.length) {
      questSealsRow.hidden = true;
      return;
    }
    questSealsRow.hidden = false;
    const label = doc.createElement('span');
    label.className = 'scroll-dialog__quest-seals-label';
    label.textContent = '简册朱印';
    questSealsRow.appendChild?.(label);

    for (let i = 0; i < seals.length; i++) {
      const item = seals[i];
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'scroll-quest-seal' + (customSeal === item.seal ? ' is-active' : '');
      if (btn.dataset) btn.dataset.seal = item.seal;
      btn.title = item.title;
      btn.setAttribute?.('title', item.title);
      btn.setAttribute?.('aria-pressed', String(customSeal === item.seal));
      btn.textContent = item.seal;
      btn.addEventListener?.('click', () => {
        const nextSeal = customSeal === item.seal ? '' : item.seal;
        customSeal = nextSeal;
        if (customSealInput) customSealInput.value = nextSeal;
        syncQuestSealPills();
        if (snapshotCanvas) updatePreviewCanvas();
        if (statusEl) {
          statusEl.textContent = nextSeal
            ? `已钤简册风物印「${nextSeal}」`
            : '已恢复贴景默认印';
        }
      });
      questSealsRow.appendChild?.(btn);
    }
  }

  let tabScrollsBtn = null;
  let journalScrollsSection = null;
  let scrollsCountEl = null;
  let scrollsStitchBtn = null;
  let scrollsClearBtn = null;
  let scrollsFilterBar = null;
  let scrollsFilterBtns = [];
  let gallerySeasonFilter = 'all';
  let scrollsGridHost = null;
  let tabNotesBtn = null;
  let tabFieldBtn = null;
  let journalOpenBtn = null;
  let createdStyleEl = false;
  let createdOpenBtn = false;
  let createdDialogEl = false;

  function triggerDataUrlDownload(dataUrl, filename) {
    if (!doc?.createElement || !dataUrl) return false;
    const a = doc.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.setAttribute?.('download', filename);
    a.style && (a.style.display = 'none');
    doc.body?.appendChild?.(a);
    try { a.click?.(); } catch {}
    removeElement(a);
    return true;
  }

  function encodeCanvasAsset(cv, mimeType = 'image/png', quality) {
    const w = Number(cv?.width) || 0;
    const h = Number(cv?.height) || 0;
    const mime = typeof mimeType === 'string' && mimeType ? mimeType : 'image/png';
    return new Promise(resolve => {
      if (cv && typeof cv.toBlob === 'function') {
        try {
          cv.toBlob(blob => {
            if (blob) {
              resolve({ blob, dataUrl: null, width: w, height: h, mimeType: blob.type || mime });
              return;
            }
            let dataUrl = null;
            try { dataUrl = cv.toDataURL?.(mime, quality) || null; } catch {}
            resolve({ blob: null, dataUrl, width: w, height: h, mimeType: mime });
          }, mime, quality);
          return;
        } catch {}
      }
      let dataUrl = null;
      try { dataUrl = cv?.toDataURL?.(mime, quality) || null; } catch {}
      resolve({ blob: null, dataUrl, width: w, height: h, mimeType: mime });
    });
  }

  function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve('');
    const FileReaderCtor = win?.FileReader || globalThis.FileReader;
    if (typeof FileReaderCtor === 'function') {
      return new Promise(resolve => {
        try {
          const fr = new FileReaderCtor();
          fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
          fr.onerror = () => resolve('');
          fr.readAsDataURL(blob);
        } catch {
          resolve('');
        }
      });
    }
    if (typeof blob.arrayBuffer === 'function' && typeof globalThis.btoa === 'function') {
      return blob.arrayBuffer().then(buf => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return 'data:' + (blob.type || 'image/png') + ';base64,' + globalThis.btoa(bin);
      }).catch(() => '');
    }
    return Promise.resolve('');
  }

  function triggerBlobDownload(blob, filename) {
    if (!blob || !doc?.createElement) return false;
    const urlApi = win?.URL || globalThis.URL;
    if (!urlApi || typeof urlApi.createObjectURL !== 'function') return false;
    let objectUrl = '';
    try {
      objectUrl = urlApi.createObjectURL(blob);
    } catch {
      return false;
    }
    if (!objectUrl) return false;
    const a = doc.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.setAttribute?.('download', filename);
    a.style && (a.style.display = 'none');
    doc.body?.appendChild?.(a);
    try { a.click?.(); } catch {}
    removeElement(a);
    if (typeof urlApi.revokeObjectURL === 'function') {
      const record = { timer: null, url: objectUrl };
      const timer = setTimeout(() => {
        pendingRevokeTimers.delete(record);
        try { urlApi.revokeObjectURL(objectUrl); } catch {}
      }, 15000);
      timer?.unref?.();
      record.timer = timer;
      pendingRevokeTimers.add(record);
    }
    return true;
  }

  async function resolveScrollOriginal(item) {
    if (!item || !item.id) return null;
    const pending = originalPendingSaves.get(item.id);
    if (pending) {
      try {
        const res = await pending;
        if (res && (res.blob || res.dataUrl)) return res;
      } catch {}
    }
    if (originalMemCache.has(item.id)) {
      return originalMemCache.get(item.id) || null;
    }
    return getOriginalRecord(item.id);
  }

  function sanitizeFilenamePart(text) {
    return String(text || '')
      .replace(/[\\/:*?"<>|\s]+/g, '')
      .slice(0, 24) || '桃源';
  }

  function updatePreviewCanvas() {
    if (!snapshotCanvas) captureRawSnapshot();
    if (!currentQueue && snapshotMeta) selectContextualQueue(snapshotMeta, { recordPick: false });
    const activeColophon = currentQueue?.items?.[currentQueuePos] || null;
    const meta = buildSceneMeta(currentVerseIdx, currentMount, snapshotMeta, null, activeColophon);
    const target = previewCanvas || mountedCanvas || createSurfaceCanvas(doc, HANDSCROLL_SIZE.width, HANDSCROLL_SIZE.height);
    renderMountedScroll(snapshotCanvas, meta, target);
    mountedCanvas = target;
    if (dialogTitleEl) {
      dialogTitleEl.textContent = meta.mount === 'hanging' ? '宣纸立轴题跋' : '宣纸横卷题跋';
    }
    if (metaTitleEl) {
      const timeMeta = meta.modernTime
        ? (meta.solarTerm ? `${meta.modernTime} · ${meta.solarTerm}` : meta.modernTime)
        : (meta.solarTerm || '');
      metaTitleEl.textContent = meta.mountLabel + ' · ' + meta.title + (timeMeta ? ' · ' + timeMeta : '');
    }
    if (metaSealEl) metaSealEl.textContent = meta.seal;
    if (sceneCuesEl) {
      const features = snapshotMeta?.sceneProfile?.detectedFeatures || [];
      const strongCount = currentQueue?.strongMatchCount || 0;
      const libCount = currentQueue?.libraryCount || CLASSICAL_COLOPHONS.length;
      if (features.length) {
        sceneCuesEl.textContent = `画心取象：${features.join(' · ')} ｜ 贴景题跋 ${strongCount} 句（总库藏 ${libCount} 句）`;
      } else {
        sceneCuesEl.textContent = `贴景题跋 ${strongCount} 句（总库藏 ${libCount} 句）`;
      }
    }
    if (mountBtn) mountBtn.setAttribute?.('data-mount', currentMount);
    if (styleBtn) {
      styleBtn.textContent = '设色：' + meta.styleLabel;
      styleBtn.setAttribute?.('data-style', meta.style);
    }
    return meta;
  }

  function saveCurrentToBox() {
    const meta = updatePreviewCanvas();
    const fullCanvas = mountedCanvas;
    const orig = renderOriginalMountedScroll(snapshotCanvas, meta);

    const compactW = PREVIEW_THUMB_WIDTH;
    const compactH = Math.max(1, Math.round((compactW * fullCanvas.height) / fullCanvas.width));
    const thumbCanvas = createSurfaceCanvas(doc, compactW, compactH);
    const tctx = thumbCanvas.getContext?.('2d');
    if (tctx) {
      if ('imageSmoothingEnabled' in tctx) tctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in tctx) tctx.imageSmoothingQuality = 'high';
      tctx.fillStyle = '#efe5cf';
      tctx.fillRect?.(0, 0, compactW, compactH);
      try { tctx.drawImage?.(fullCanvas, 0, 0, compactW, compactH); } catch {}
    }
    const dataUrl = thumbCanvas.toDataURL('image/jpeg', PREVIEW_THUMB_QUALITY);
    thumbCanvas.width = 0;
    thumbCanvas.height = 0;

    const entryId = 'scroll-' + Date.now().toString(36) + '-' + (++saveSeq).toString(36) + '-' + Math.floor((captureCount * 97 + savedScrolls.length * 31) % 997).toString(36);
    const createdAt = Date.now();
    const entry = {
      id: entryId,
      title: meta.title,
      verse: meta.verse,
      seal: meta.seal,
      sealStyle: meta.sealStyle || 'zhuwen',
      mount: meta.mount,
      style: meta.style,
      region: meta.region,
      timeLabel: meta.timeLabel,
      createdAt,
      hasOriginal: true,
      originalWidth: orig.width,
      originalHeight: orig.height,
      originalMime: 'image/png',
      dataUrl
    };
    if (meta.modernTime) {
      entry.modernTime = meta.modernTime;
    }
    if (meta.solarTerm) {
      entry.solarTerm = meta.solarTerm;
    }
    if (meta.solarWhisper) {
      entry.solarWhisper = meta.solarWhisper;
    }
    if (meta.phenology?.id) {
      entry.phenology = meta.phenology.id;
    }
    if (Number.isFinite(snapshotMeta?.x) && Number.isFinite(snapshotMeta?.z)) {
      entry.x = snapshotMeta.x;
      entry.z = snapshotMeta.z;
    }
    if (Number.isFinite(snapshotMeta?.yaw)) {
      entry.yaw = snapshotMeta.yaw;
    }

    savedScrolls = [entry, ...savedScrolls].slice(0, MAX_SAVED_SCROLLS);
    rememberColophon({ id: meta.colophonId, verse: meta.verse });
    const ok = persistScrolls();
    const stillKept = savedScrolls.some(s => s.id === entryId);
    if (stillKept) {
      const savePromise = (async () => {
        let asset = null;
        try {
          asset = await encodeCanvasAsset(orig.canvas, 'image/png');
        } finally {
          orig.canvas.width = 0;
          orig.canvas.height = 0;
        }
        if (disposed || !savedScrolls.some(s => s.id === entryId)) {
          return null;
        }
        if (!asset || (!asset.blob && !asset.dataUrl)) {
          return null;
        }
        const record = {
          id: entryId,
          blob: asset.blob || null,
          dataUrl: asset.blob ? null : asset.dataUrl,
          width: orig.width,
          height: orig.height,
          mimeType: asset.mimeType || 'image/png',
          createdAt
        };
        originalMemCache.set(entryId, record);
        const persisted = await putOriginalRecord(record);
        if (!savedScrolls.some(s => s.id === entryId)) {
          originalMemCache.delete(entryId);
          void deleteOriginalRecord(entryId);
          return null;
        }
        if (disposed || persisted) {
          originalMemCache.delete(entryId);
        }
        return record;
      })().finally(() => {
        if (originalPendingSaves.get(entryId) === savePromise) {
          originalPendingSaves.delete(entryId);
        }
      });
      originalPendingSaves.set(entryId, savePromise);
    } else {
      orig.canvas.width = 0;
      orig.canvas.height = 0;
    }
    pruneOrphanedOriginals();
    renderJournalGallery();
    if (statusEl) {
      statusEl.textContent = ok
        ? ('已收入游记 · 画匣（原图 ' + orig.width + '×' + orig.height + '）')
        : '浏览器存储空间受限，画匣未能持久保存。';
    }
    return entry;
  }

  async function downloadSavedScroll(itemOrId) {
    const item = typeof itemOrId === 'string'
      ? savedScrolls.find(s => s.id === itemOrId)
      : itemOrId;
    if (!item) return null;
    const baseName = '桃花源记-' + sanitizeFilenamePart(item.region) + '-' + sanitizeFilenamePart(item.timeLabel);
    const original = await resolveScrollOriginal(item);
    if (original && (original.blob || original.dataUrl)) {
      const mimeType = original.mimeType || (original.dataUrl?.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png');
      const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
      const filename = baseName + ext;
      if (original.blob) {
        let downloaded = triggerBlobDownload(original.blob, filename);
        if (!downloaded) {
          const converted = await blobToDataUrl(original.blob);
          const urlToUse = converted || original.dataUrl;
          if (urlToUse) {
            downloaded = triggerDataUrlDownload(urlToUse, filename);
          }
        }
        if (downloaded) {
          return {
            filename,
            isOriginal: true,
            width: Number(original.width) || Number(item.originalWidth) || 0,
            height: Number(original.height) || Number(item.originalHeight) || 0,
            mimeType
          };
        }
      } else {
        triggerDataUrlDownload(original.dataUrl, filename);
        return {
          filename,
          isOriginal: true,
          width: Number(original.width) || Number(item.originalWidth) || 0,
          height: Number(original.height) || Number(item.originalHeight) || 0,
          mimeType
        };
      }
    }
    const fallbackMime = item.dataUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    const ext = fallbackMime === 'image/png' ? '.png' : '.jpg';
    const filename = baseName + ext;
    triggerDataUrlDownload(item.dataUrl, filename);
    return {
      filename,
      isOriginal: false,
      width: Number(item.originalWidth) || 0,
      height: Number(item.originalHeight) || 0,
      mimeType: fallbackMime
    };
  }

  function enterScrollWorld(itemOrId) {
    const item = typeof itemOrId === 'string'
      ? savedScrolls.find(s => s.id === itemOrId)
      : itemOrId;
    if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.z))) return false;
    if (isOpen()) close();
    journal?.close?.();
    if (map?.isOpen?.()) map.close?.();
    if (getTravelerGuide?.()?.cruiseActive) getTravelerGuide().stopCruise?.();
    if (riverSkiff?.isAboard?.()) riverSkiff.disembark?.();
    const tx = Number(item.x);
    const tz = Number(item.z);
    const tyaw = Number.isFinite(Number(item.yaw)) ? Number(item.yaw) : (player?.state?.yaw || 0);
    if (act3Finale?.getState?.()?.caveSealed && tz < -20) {
      if (typeof act3Finale.dreamReturnToValley === 'function') {
        act3Finale.dreamReturnToValley({ x: tx, z: tz, yaw: tyaw });
      } else {
        act3Finale.reset?.({ respawn: false, resetDialogue: false });
      }
    }
    if (player?.state) {
      player.state.aboardSkiff = false;
      player.state.still = false;
      player.state.vx = 0;
      player.state.vz = 0;
      player.state.x = tx;
      player.state.z = tz;
      if (typeof field?.walkSurface === 'function') player.state.y = field.walkSurface(tx, tz);
      else if (field?.sample) player.state.y = field.sample(tx, tz);
      player.state.yaw = tyaw;
      player.state.targetYaw = tyaw;
      player.clearInput?.();
      if (camera) player.syncCamera?.(camera);
    }
    const noteEl = doc?.getElementById?.('mystery-note');
    if (noteEl) {
      noteEl.textContent = '展卷入画 · 重游「' + (item.region || '桃花源') + '」';
      noteEl.classList?.add?.('show');
    }
    enterWorldCount++;
    return true;
  }

  function composePanoramicCanvas(items, decodedImages = []) {
    const list = items.slice(0, MAX_SAVED_SCROLLS);
    const H = 760;
    const frontW = 250;
    const panelW = 780;
    const sepW = 36;
    const tailW = 210;
    const W = frontW + list.length * panelW + Math.max(0, list.length - 1) * sepW + tailW;
    let hasHighRes = false;
    for (let i = 0; i < decodedImages.length; i++) {
      const img = decodedImages[i];
      const nw = Number(img?.naturalWidth || img?.width) || 0;
      if (nw > panelW) {
        hasHighRes = true;
        break;
      }
    }
    const panScale = hasHighRes ? Math.max(1, Math.min(2, MAX_PANORAMIC_WIDTH / W)) : 1;
    const outW = Math.max(1, Math.round(W * panScale));
    const outH = Math.max(1, Math.round(H * panScale));
    const panCanvas = createSurfaceCanvas(doc, outW, outH);
    const ctx = panCanvas.getContext?.('2d') || fallbackCanvas2DContext(panCanvas);
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.clearRect?.(0, 0, outW, outH);
    ctx.save?.();
    if (panScale !== 1) ctx.scale?.(panScale, panScale);

    fillLinear(ctx, 0, 0, W, H, [
      [0, '#e8dec6'],
      [0.5, '#efe6d0'],
      [1, '#e3d6b9']
    ], '#ece2cb');
    ctx.fillRect?.(0, 0, W, H);
    drawSilkBrocadePattern(ctx, W, H, 'rgba(104, 88, 64, 0.048)');

    const matX = 28;
    const matY = 26;
    const matW = W - 56;
    const matH = H - 52;
    fillLinear(ctx, matX, matY, matX, matY + matH, [
      [0, '#f5eddc'],
      [1, '#ede1c8']
    ], '#f2ead9');
    ctx.fillRect?.(matX, matY, matW, matH);
    drawXuanPaperFibers(ctx, matX, matY, matW, matH, 20261119, 140, 360);
    ctx.strokeStyle = 'rgba(92, 76, 56, 0.36)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect?.(matX + 0.5, matY + 0.5, matW - 1, matH - 1);

    // 右首引首（传统手卷自右向左展读，亦兼顾现代左起横览：左引首 + 诸幅画心 + 右收卷跋尾）
    ctx.save?.();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2c2620';
    ctx.font = '32px ' + SERIF_FONT;
    drawVerticalString(ctx, '桃源四时行旅图卷', matX + 108, matY + 92, 46, matY + matH - 130);
    drawCinnabarSeal(ctx, matX + 76, matY + matH - 116, 64, '武陵清赏', '#efe4cd', 0x31a7);
    ctx.restore?.();

    ctx.strokeStyle = 'rgba(92, 76, 56, 0.28)';
    ctx.beginPath?.();
    ctx.moveTo?.(frontW, matY + 20);
    ctx.lineTo?.(frontW, matY + matH - 20);
    ctx.stroke?.();

    // 诸幅画卷依次铺陈
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const px = frontW + i * (panelW + sepW) + 18;
      const py = matY + 28;
      const pw = panelW - 36;
      const ph = 490;
      ctx.fillStyle = '#e7dcc4';
      ctx.fillRect?.(px, py, pw, ph);
      const imgSrc = decodedImages[i];
      if (imgSrc && typeof ctx.drawImage === 'function') {
        if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        const iw = Number(imgSrc.naturalWidth || imgSrc.width) || pw;
        const ih = Number(imgSrc.naturalHeight || imgSrc.height) || ph;
        if (iw > 0 && ih > 0) {
          const fit = Math.min(pw / iw, ph / ih);
          const dw = iw * fit;
          const dh = ih * fit;
          const dx = px + (pw - dw) * 0.5;
          const dy = py + (ph - dh) * 0.5;
          try { ctx.drawImage(imgSrc, dx, dy, dw, dh); } catch {}
        } else {
          try { ctx.drawImage(imgSrc, px, py, pw, ph); } catch {}
        }
      }
      ctx.strokeStyle = 'rgba(72, 58, 44, 0.36)';
      ctx.lineWidth = 1;
      ctx.strokeRect?.(px - 0.5, py - 0.5, pw + 1, ph + 1);

      ctx.save?.();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#6a5946';
      ctx.font = '14px ' + SERIF_FONT;
      ctx.fillText?.('其' + (i + 1) + ' · ' + (it.title || '桃源行纪'), px + 4, py + ph + 32);
      ctx.fillStyle = '#2b2621';
      ctx.font = '20px ' + SERIF_FONT;
      ctx.fillText?.(it.verse || '', px + 4, py + ph + 72);
      ctx.restore?.();
      drawCinnabarSeal(ctx, px + pw - 62, py + ph + 24, 56, it.seal || '怡然自乐', '#efe4cd', 0x5100 + i);

      if (i < list.length - 1) {
        const sx = frontW + (i + 1) * panelW + i * sepW + sepW * 0.5;
        ctx.strokeStyle = 'rgba(110, 92, 68, 0.24)';
        ctx.beginPath?.();
        ctx.moveTo?.(sx, matY + 24);
        ctx.lineTo?.(sx, matY + matH - 24);
        ctx.stroke?.();
      }
    }

    // 卷尾拖尾题记
    const tx0 = W - tailW + 18;
    ctx.strokeStyle = 'rgba(92, 76, 56, 0.28)';
    ctx.beginPath?.();
    ctx.moveTo?.(W - tailW, matY + 20);
    ctx.lineTo?.(W - tailW, matY + matH - 20);
    ctx.stroke?.();
    ctx.save?.();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5c4e3d';
    ctx.font = '15px ' + SERIF_FONT;
    drawVerticalString(ctx, '右合装桃源丹青凡' + list.length + '幅', tx0 + 62, matY + 96, 26, matY + matH - 130);
    drawCinnabarSeal(ctx, tx0 + 34, matY + matH - 112, 56, '桃源岁月', '#efe4cd', 0x89c2);
    ctx.restore?.();

    ctx.restore?.();
    return panCanvas;
  }

  async function exportPanoramicScroll() {
    if (!savedScrolls.length) return null;
    const list = savedScrolls.slice().reverse();
    const decoded = [];
    const tempUrls = [];
    const urlApi = win?.URL || globalThis.URL;
    const ImageCtor = win?.Image || globalThis.Image;
    try {
      if (typeof ImageCtor === 'function') {
        for (let i = 0; i < list.length; i++) {
          const original = await resolveScrollOriginal(list[i]);
          let srcUrl = list[i].dataUrl;
          if (original?.blob) {
            if (urlApi && typeof urlApi.createObjectURL === 'function') {
              try {
                const objUrl = urlApi.createObjectURL(original.blob);
                if (objUrl) {
                  tempUrls.push(objUrl);
                  srcUrl = objUrl;
                }
              } catch {}
            }
            if (srcUrl === list[i].dataUrl) {
              const converted = await blobToDataUrl(original.blob);
              if (converted) srcUrl = converted;
            }
          } else if (original?.dataUrl) {
            srcUrl = original.dataUrl;
          }
          const img = await new Promise(resolve => {
            try {
              const el = new ImageCtor();
              el.onload = () => resolve(el);
              el.onerror = () => resolve(null);
              el.src = srcUrl;
              if (el.complete) resolve(el);
            } catch {
              resolve(null);
            }
          });
          decoded.push(img);
        }
      }
      const panCanvas = composePanoramicCanvas(list, decoded);
      let asset;
      try {
        asset = await encodeCanvasAsset(panCanvas, 'image/png');
      } finally {
        panCanvas.width = 0;
        panCanvas.height = 0;
      }
      const fname = '桃花源记-四时行旅合卷-' + list.length + '幅.png';
      if (asset?.blob) {
        const downloaded = triggerBlobDownload(asset.blob, fname);
        if (!downloaded) {
          const fallbackUrl = await blobToDataUrl(asset.blob);
          if (fallbackUrl) triggerDataUrlDownload(fallbackUrl, fname);
        }
      } else if (asset?.dataUrl) {
        triggerDataUrlDownload(asset.dataUrl, fname);
      }
      stitchCount++;
      return {
        filename: fname,
        count: list.length,
        dataUrl: asset?.dataUrl || '',
        width: asset?.width || 0,
        height: asset?.height || 0
      };
    } finally {
      if (urlApi && typeof urlApi.revokeObjectURL === 'function') {
        for (let i = 0; i < tempUrls.length; i++) {
          try { urlApi.revokeObjectURL(tempUrls[i]); } catch {}
        }
      }
    }
  }

  async function downloadCurrentPng() {
    const meta = updatePreviewCanvas();
    rememberColophon({ id: meta.colophonId, verse: meta.verse });
    const fname = '桃花源记-' + sanitizeFilenamePart(meta.region) + '-' + sanitizeFilenamePart(meta.timeLabel) + '.png';
    if (downloadBtn) downloadBtn.disabled = true;
    try {
      const orig = renderOriginalMountedScroll(snapshotCanvas, meta);
      let asset;
      try {
        asset = await encodeCanvasAsset(orig.canvas, 'image/png');
      } finally {
        orig.canvas.width = 0;
        orig.canvas.height = 0;
      }
      let downloaded = false;
      if (asset?.blob) {
        downloaded = triggerBlobDownload(asset.blob, fname);
        if (!downloaded) {
          const fallbackUrl = await blobToDataUrl(asset.blob);
          if (fallbackUrl) downloaded = triggerDataUrlDownload(fallbackUrl, fname);
        }
      } else if (asset?.dataUrl) {
        downloaded = triggerDataUrlDownload(asset.dataUrl, fname);
      }
      if (statusEl) {
        statusEl.textContent = downloaded
          ? ('已展卷珍藏原图（' + orig.width + '×' + orig.height + '）：' + fname)
          : '未能生成画卷下载文件。';
      }
      return fname;
    } finally {
      if (downloadBtn) downloadBtn.disabled = false;
    }
  }

  function removeSavedScroll(id) {
    const next = savedScrolls.filter(item => item.id !== id);
    if (next.length === savedScrolls.length) return false;
    savedScrolls = next;
    originalMemCache.delete(id);
    originalPendingSaves.delete(id);
    void deleteOriginalRecord(id);
    persistScrolls();
    renderJournalGallery();
    return true;
  }

  function clearSavedScrolls() {
    savedScrolls = [];
    originalMemCache.clear();
    originalPendingSaves.clear();
    void clearOriginalRecords();
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(STORAGE_KEY, '[]');
        storageOK = true;
      } catch {
        storageOK = false;
      }
    }
    renderJournalGallery();
    return true;
  }

  const GALLERY_SEASON_TABS = [
    { id: 'all', label: '全部' },
    { id: 'spring', label: '春', hint: '春深' },
    { id: 'summer', label: '夏', hint: '夏荷' },
    { id: 'autumn', label: '秋', hint: '秋粟' },
    { id: 'winter', label: '冬', hint: '冬雪' }
  ];

  function inferScrollSeason(item) {
    if (!item || typeof item !== 'object') return 'spring';
    if (item.phenology === 'spring' || item.phenology === 'summer' || item.phenology === 'autumn' || item.phenology === 'winter') {
      return item.phenology;
    }
    const title = String(item.title || '');
    if (title.includes('夏荷') || title.includes('盛夏')) return 'summer';
    if (title.includes('秋粟') || title.includes('秋色')) return 'autumn';
    if (title.includes('冬雪') || title.includes('冬寂')) return 'winter';
    if (title.includes('春深') || title.includes('春桃')) return 'spring';
    const mt = String(item.modernTime || '');
    const m = mt.match(/(\d{1,2})月/);
    if (m) {
      const mo = Number(m[1]);
      if (mo >= 6 && mo <= 8) return 'summer';
      if (mo >= 9 && mo <= 11) return 'autumn';
      if (mo === 12 || mo <= 2) return 'winter';
      return 'spring';
    }
    return 'spring';
  }

  function setGallerySeasonFilter(seasonId) {
    const valid = GALLERY_SEASON_TABS.some(t => t.id === seasonId);
    gallerySeasonFilter = valid ? seasonId : 'all';
    renderJournalGallery();
    return gallerySeasonFilter;
  }

  function renderJournalGallery() {
    if (tabScrollsBtn) {
      tabScrollsBtn.textContent = savedScrolls.length > 0 ? '画匣 (' + savedScrolls.length + ')' : '画匣';
    }
    if (!journalScrollsSection || !doc?.createElement) return;

    const seasonCounts = { all: savedScrolls.length, spring: 0, summer: 0, autumn: 0, winter: 0 };
    for (let i = 0; i < savedScrolls.length; i++) {
      seasonCounts[inferScrollSeason(savedScrolls[i])]++;
    }
    for (let i = 0; i < scrollsFilterBtns.length; i++) {
      const fb = scrollsFilterBtns[i];
      const tab = GALLERY_SEASON_TABS[i];
      if (!fb || !tab) continue;
      const cnt = seasonCounts[tab.id] || 0;
      fb.textContent = cnt > 0 && tab.id !== 'all' ? `${tab.label} (${cnt})` : (tab.id === 'all' && cnt > 0 ? `全部 (${cnt})` : tab.label);
      fb.setAttribute?.('aria-pressed', String(gallerySeasonFilter === tab.id));
    }

    const filtered = gallerySeasonFilter === 'all'
      ? savedScrolls
      : savedScrolls.filter(item => inferScrollSeason(item) === gallerySeasonFilter);

    if (scrollsCountEl) {
      scrollsCountEl.textContent = gallerySeasonFilter === 'all'
        ? ('已收丹青 ' + savedScrolls.length + ' / ' + MAX_SAVED_SCROLLS + ' 卷（独立存于本浏览器画匣）')
        : ('当前筛阅 ' + filtered.length + ' 卷 / 共藏 ' + savedScrolls.length + ' 卷');
    }
    if (scrollsStitchBtn) {
      scrollsStitchBtn.disabled = savedScrolls.length === 0;
    }
    if (scrollsClearBtn) {
      scrollsClearBtn.disabled = savedScrolls.length === 0;
    }
    if (!scrollsGridHost) return;

    if (typeof scrollsGridHost.replaceChildren === 'function') {
      scrollsGridHost.replaceChildren();
    } else if (Array.isArray(scrollsGridHost.children)) {
      scrollsGridHost.children.length = 0;
    }

    if (savedScrolls.length === 0) {
      const emptyEl = doc.createElement('p');
      emptyEl.className = 'scroll-box__empty journal__empty';
      emptyEl.textContent = '尚未留下丹青画卷 — 游赏时按 O 键即可入画。';
      scrollsGridHost.appendChild?.(emptyEl);
      return;
    }

    if (filtered.length === 0) {
      const tab = GALLERY_SEASON_TABS.find(t => t.id === gallerySeasonFilter);
      const emptyEl = doc.createElement('p');
      emptyEl.className = 'scroll-box__empty journal__empty';
      emptyEl.textContent = `画匣中尚无「${tab ? tab.label : ''}」季丹青 — 按 K 切换四时物候，按 O 键即可入画珍藏。`;
      scrollsGridHost.appendChild?.(emptyEl);
      return;
    }

    const grid = doc.createElement('div');
    grid.className = 'scroll-box__grid';
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      const card = doc.createElement('article');
      card.className = 'scroll-card';

      const img = doc.createElement('img');
      img.className = 'scroll-card__img';
      img.src = item.dataUrl;
      img.alt = item.title;
      img.setAttribute?.('src', item.dataUrl);
      img.setAttribute?.('alt', item.title);

      const titleP = doc.createElement('p');
      titleP.className = 'scroll-card__title';
      titleP.textContent = (item.mount === 'hanging' ? '〔立轴〕' : '〔横卷〕') + item.title;

      const verseP = doc.createElement('p');
      verseP.className = 'scroll-card__verse';
      verseP.textContent = item.verse;

      const foot = doc.createElement('div');
      foot.className = 'scroll-card__foot';

      const sealSpan = doc.createElement('span');
      sealSpan.className = 'scroll-card__seal';
      sealSpan.textContent = item.seal;

      const btns = doc.createElement('div');
      btns.className = 'scroll-card__btns';

      if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z))) {
        const goBtn = doc.createElement('button');
        goBtn.type = 'button';
        goBtn.textContent = '入画重游';
        goBtn.addEventListener?.('click', () => {
          enterScrollWorld(item);
        });
        btns.appendChild?.(goBtn);
      }

      const dlBtn = doc.createElement('button');
      dlBtn.type = 'button';
      dlBtn.textContent = '展卷下载';
      const dlTip = item.hasOriginal
        ? (item.originalWidth && item.originalHeight
          ? '下载高清无损 PNG 原图（' + item.originalWidth + '×' + item.originalHeight + '）'
          : '下载高清无损 PNG 原图')
        : '旧版缩略存档；可点击「入画重游」后重新按 O 入画获取高清原图';
      dlBtn.title = dlTip;
      dlBtn.setAttribute?.('title', dlTip);
      dlBtn.addEventListener?.('click', async () => {
        if (dlBtn.disabled) return;
        dlBtn.disabled = true;
        try {
          await downloadSavedScroll(item);
        } finally {
          dlBtn.disabled = false;
        }
      });

      const rmBtn = doc.createElement('button');
      rmBtn.type = 'button';
      rmBtn.textContent = '移出';
      rmBtn.addEventListener?.('click', () => {
        removeSavedScroll(item.id);
      });

      btns.appendChild?.(dlBtn);
      btns.appendChild?.(rmBtn);
      foot.appendChild?.(sealSpan);
      foot.appendChild?.(btns);

      card.appendChild?.(img);
      card.appendChild?.(titleP);
      if (item.modernTime || item.solarTerm) {
        const timeP = doc.createElement('p');
        timeP.className = 'scroll-card__time';
        timeP.textContent = item.modernTime
          ? (item.solarTerm ? `${item.modernTime} · ${item.solarTerm}` : item.modernTime)
          : item.solarTerm;
        card.appendChild?.(timeP);
      }
      card.appendChild?.(verseP);
      card.appendChild?.(foot);
      grid.appendChild?.(card);
    }
    scrollsGridHost.appendChild?.(grid);
  }

  function selectScrollsTab() {
    const notesEl = doc?.getElementById?.('journal-notes');
    const fieldEl = doc?.getElementById?.('journal-field');
    if (notesEl) notesEl.hidden = true;
    if (fieldEl) fieldEl.hidden = true;
    if (journalScrollsSection) journalScrollsSection.hidden = false;
    tabNotesBtn?.setAttribute?.('aria-pressed', 'false');
    tabFieldBtn?.setAttribute?.('aria-pressed', 'false');
    tabScrollsBtn?.setAttribute?.('aria-pressed', 'true');
    renderJournalGallery();
  }

  function deselectScrollsTab() {
    if (journalScrollsSection) journalScrollsSection.hidden = true;
    tabScrollsBtn?.setAttribute?.('aria-pressed', 'false');
  }

  function onJournalOpenRefresh() {
    renderJournalGallery();
  }

  function isVeilBlocking() {
    return sharedIsVeilBlocking(doc);
  }

  function isOpen() {
    return Boolean(dialogEl?.open);
  }

  function handleDialogClosed() {
    doc?.body?.classList?.remove?.('scroll-studio-open');
    player?.clearInput?.();
    const relock = wasLocked;
    wasLocked = false;
    if (returnToRoaming && canvas?.focus) {
      try { canvas.focus({ preventScroll: true }); } catch { canvas.focus(); }
    } else if (returnFocus && returnFocus !== canvas && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    } else {
      openBtn?.focus?.();
    }
    if (relock && canvas) {
      try { canvas.focus?.({ preventScroll: true }); } catch {}
      try { Promise.resolve(canvas.requestPointerLock?.()).catch?.(() => {}); } catch {}
    }
  }

  function openCapture(fromKeyboard = false, opts = null) {
    if (disposed || isOpen()) return false;
    if (isModalBusy(doc, { ignore: 'scroll-studio-open', includeVeil: false, includeCruise: false, runtime: { map, journal } })) {
      return false;
    }

    // 先同步渲染并定格当前 3D 帧，确保零白屏且装裱/换跋无需重拍
    captureRawSnapshot();
    selectContextualQueue(snapshotMeta, { recordPick: true });
    refreshQuestSeals();
    updatePreviewCanvas();
    syncQuestSealPills();
    if (statusEl) {
      statusEl.textContent = (typeof opts?.statusHint === 'string' && opts.statusHint.trim())
        ? opts.statusHint.trim()
        : '';
    }

    returnFocus = doc?.activeElement || null;
    returnToRoaming = fromKeyboard === true && (returnFocus === doc?.body || returnFocus === canvas);
    wasLocked = Boolean(canvas && doc?.pointerLockElement === canvas);
    player?.clearInput?.();
    if (doc?.pointerLockElement) {
      try { doc.exitPointerLock?.(); } catch {}
    }

    if (dialogEl) {
      doc?.body?.classList?.add?.('scroll-studio-open');
      if (typeof dialogEl.showModal === 'function') {
        dialogEl.showModal();
      } else {
        dialogEl.open = true;
      }
      closeBtn?.focus?.();
    }
    return true;
  }

  function close() {
    if (!dialogEl || !dialogEl.open) return false;
    player?.clearInput?.();
    if (typeof dialogEl.close === 'function') {
      dialogEl.close();
    } else {
      dialogEl.open = false;
      handleDialogClosed();
    }
    return true;
  }

  function onMountToggleClick() {
    currentMount = currentMount === 'handscroll' ? 'hanging' : 'handscroll';
    const meta = updatePreviewCanvas();
    if (statusEl) statusEl.textContent = '已切换为「' + meta.mountLabel + '」';
  }

  function onStyleCycleClick() {
    currentStyleIdx = (currentStyleIdx + 1) % BRUSH_STYLES.length;
    const meta = updatePreviewCanvas();
    if (statusEl) statusEl.textContent = '已换笔意设色：「' + meta.styleLabel + '」';
  }

  function onStitchScrollsClick() {
    void exportPanoramicScroll();
  }

  function onVerseCycleClick() {
    customVerse = '';
    if (customVerseInput) customVerseInput.value = '';
    if (!currentQueue || !currentQueue.items?.length) {
      if (!snapshotCanvas) captureRawSnapshot();
      selectContextualQueue(snapshotMeta, { recordPick: false });
    }
    const list = currentQueue?.items || CLASSICAL_COLOPHONS;
    currentQueuePos = (currentQueuePos + 1) % list.length;
    const active = list[currentQueuePos] || CLASSICAL_COLOPHONS[0];
    if (Number.isInteger(active?.libraryIndex)) {
      currentVerseIdx = active.libraryIndex;
    }
    const meta = updatePreviewCanvas();
    if (statusEl) {
      const strongTotal = Math.max(1, currentQueue?.strongMatchCount || list.length);
      const posLabel = currentQueuePos < strongTotal
        ? `第 ${currentQueuePos + 1} / ${strongTotal} 贴景`
        : `第 ${currentQueuePos + 1} / ${list.length} 句`;
      const kindTag = active?.composed ? ' · 即景联' : '';
      statusEl.textContent = `已换贴景题跋（${posLabel}${kindTag}）· 钤印「${meta.seal}」`;
    }
  }

  function setCustomInscription({ verse, seal, sealStyle } = {}) {
    if (verse !== undefined) {
      customVerse = String(verse || '').trim().slice(0, 24);
      if (customVerseInput && customVerseInput.value !== customVerse) customVerseInput.value = customVerse;
    }
    if (seal !== undefined) {
      customSeal = String(seal || '').trim().slice(0, 4);
      if (customSealInput && customSealInput.value !== customSeal) customSealInput.value = customSeal;
      syncQuestSealPills();
    }
    if (sealStyle === 'zhuwen' || sealStyle === 'baiwen') {
      currentSealStyle = sealStyle;
      if (sealStyleBtn) sealStyleBtn.textContent = currentSealStyle === 'baiwen' ? '印式：白文' : '印式：朱文';
    }
    if (snapshotCanvas) updatePreviewCanvas();
    return getCustomInscription();
  }

  function getCustomInscription() {
    return { verse: customVerse, seal: customSeal, sealStyle: currentSealStyle };
  }

  function onCustomVerseInput() {
    customVerse = String(customVerseInput?.value || '').trim().slice(0, 24);
    if (snapshotCanvas) updatePreviewCanvas();
  }

  function onCustomSealInput() {
    customSeal = String(customSealInput?.value || '').trim().slice(0, 4);
    syncQuestSealPills();
    if (snapshotCanvas) updatePreviewCanvas();
  }

  function onSealStyleToggleClick() {
    currentSealStyle = currentSealStyle === 'zhuwen' ? 'baiwen' : 'zhuwen';
    if (sealStyleBtn) sealStyleBtn.textContent = currentSealStyle === 'baiwen' ? '印式：白文' : '印式：朱文';
    const meta = updatePreviewCanvas();
    if (statusEl) statusEl.textContent = '印式已切为「' + (currentSealStyle === 'baiwen' ? '白文阴刻' : '朱文阳刻') + ' · ' + meta.seal + '」';
  }

  function onSaveBoxClick() {
    saveCurrentToBox();
  }

  function onDownloadPngClick() {
    void downloadCurrentPng();
  }

  function onDialogBackdropClick(event) {
    if (event?.target === dialogEl) close();
  }

  function onOpenBtnClick() {
    openCapture(false);
  }

  function onClearBoxClick() {
    if (typeof win?.confirm === 'function' && !win.confirm('确定清空画匣中珍藏的所有丹青画卷？游记行迹与图鉴不会受影响。')) {
      return;
    }
    clearSavedScrolls();
  }

  function onKeyDown(event) {
    if (disposed || !event) return;
    if (isOpen()) {
      const t = event.target;
      const typing = Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));
      if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.code === 'Escape' || (event.code === 'KeyO' && !typing)) {
          event.preventDefault?.();
          close();
        }
      }
      event.stopImmediatePropagation?.();
      return;
    }

    if (event.code === 'KeyJ' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      onJournalOpenRefresh();
      return;
    }

    if (event.code !== 'KeyO' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (isModalBusy(doc, { ignore: 'scroll-studio-open', includeVeil: true, includeCruise: false, runtime: { map, journal } })) {
      return;
    }

    event.preventDefault?.();
    openCapture(true);
  }

  if (doc?.createElement) {
    // 1. 注入幂等样式 #scroll-studio-styles
    styleEl = doc.getElementById?.('scroll-studio-styles') || null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'scroll-studio-styles';
      styleEl.textContent = STUDIO_CSS;
      const styleHost = doc.head || doc.body || doc.documentElement;
      styleHost?.appendChild?.(styleEl);
      createdStyleEl = true;
    }

    // 2. 注入左上角「丹青 O」按钮（与 #journal-open 并列对齐）
    openBtn = doc.getElementById?.('scroll-open') || null;
    if (!openBtn && doc.body) {
      openBtn = doc.createElement('button');
      openBtn.id = 'scroll-open';
      openBtn.className = 'scroll-open';
      openBtn.type = 'button';
      openBtn.setAttribute?.('aria-keyshortcuts', 'O');
      openBtn.textContent = '丹青 ';
      const keySpan = doc.createElement('span');
      keySpan.textContent = 'O';
      openBtn.appendChild?.(keySpan);
      const dockHost = doc.getElementById?.('hud-top-dock') || doc.body;
      dockHost.appendChild?.(openBtn);
      createdOpenBtn = true;
    }
    openBtn?.addEventListener?.('click', onOpenBtnClick);

    // 3. 构建 <dialog id="scroll-dialog"> 画卷装裱室弹窗
    dialogEl = doc.getElementById?.('scroll-dialog') || null;
    if (!dialogEl && doc.body) {
      dialogEl = doc.createElement('dialog');
      dialogEl.id = 'scroll-dialog';
      dialogEl.className = 'scroll-dialog';
      dialogEl.setAttribute?.('aria-labelledby', 'scroll-dialog-title');

      const header = doc.createElement('header');
      header.className = 'scroll-dialog__head';
      const titleBox = doc.createElement('div');
      const eyebrow = doc.createElement('p');
      eyebrow.className = 'scroll-dialog__eyebrow';
      eyebrow.textContent = '桃源 · 丹青留影';
      const h2 = doc.createElement('h2');
      h2.id = 'scroll-dialog-title';
      h2.textContent = currentMount === 'hanging' ? '宣纸立轴题跋' : '宣纸横卷题跋';
      dialogTitleEl = h2;
      titleBox.appendChild?.(eyebrow);
      titleBox.appendChild?.(h2);

      closeBtn = doc.createElement('button');
      closeBtn.id = 'scroll-close';
      closeBtn.type = 'button';
      closeBtn.setAttribute?.('aria-label', '关闭丹青画卷');
      closeBtn.textContent = '合';
      header.appendChild?.(titleBox);
      header.appendChild?.(closeBtn);

      const stage = doc.createElement('div');
      stage.className = 'scroll-dialog__stage';
      previewCanvas = createSurfaceCanvas(doc, HANDSCROLL_SIZE.width, HANDSCROLL_SIZE.height);
      previewCanvas.id = 'scroll-preview-canvas';
      stage.appendChild?.(previewCanvas);

      const metaRow = doc.createElement('div');
      metaRow.className = 'scroll-dialog__meta';
      metaTitleEl = doc.createElement('span');
      metaTitleEl.id = 'scroll-meta-title';
      metaSealEl = doc.createElement('span');
      metaSealEl.id = 'scroll-meta-seal';
      metaSealEl.className = 'scroll-dialog__seal-tag';
      metaRow.appendChild?.(metaTitleEl);
      metaRow.appendChild?.(metaSealEl);

      sceneCuesEl = doc.createElement('div');
      sceneCuesEl.id = 'scroll-scene-cues';
      sceneCuesEl.className = 'scroll-dialog__cues';

      const actions = doc.createElement('div');
      actions.className = 'scroll-dialog__actions';

      mountBtn = doc.createElement('button');
      mountBtn.id = 'scroll-mount-toggle';
      mountBtn.type = 'button';
      mountBtn.textContent = '装裱：横卷 / 立轴';

      styleBtn = doc.createElement('button');
      styleBtn.id = 'scroll-style-cycle';
      styleBtn.type = 'button';
      styleBtn.textContent = '设色：青绿重彩';

      verseBtn = doc.createElement('button');
      verseBtn.id = 'scroll-verse-cycle';
      verseBtn.type = 'button';
      verseBtn.textContent = '换一句题跋';

      saveBtn = doc.createElement('button');
      saveBtn.id = 'scroll-save-box';
      saveBtn.type = 'button';
      saveBtn.className = 'scroll-btn--seal';
      saveBtn.textContent = '收入画匣';

      downloadBtn = doc.createElement('button');
      downloadBtn.id = 'scroll-download-png';
      downloadBtn.type = 'button';
      downloadBtn.textContent = '展卷珍藏（下载 PNG）';

      actions.appendChild?.(mountBtn);
      actions.appendChild?.(styleBtn);
      actions.appendChild?.(verseBtn);
      actions.appendChild?.(saveBtn);
      actions.appendChild?.(downloadBtn);

      const customRow = doc.createElement('div');
      customRow.className = 'scroll-dialog__custom';

      const verseLabel = doc.createElement('label');
      verseLabel.textContent = '自题 ';
      customVerseInput = doc.createElement('input');
      customVerseInput.id = 'scroll-custom-verse';
      customVerseInput.type = 'text';
      customVerseInput.maxLength = 24;
      customVerseInput.placeholder = '自题短跋（留空依画心景物择句）';
      verseLabel.appendChild?.(customVerseInput);

      const sealLabel = doc.createElement('label');
      sealLabel.textContent = '私印 ';
      customSealInput = doc.createElement('input');
      customSealInput.id = 'scroll-custom-seal';
      customSealInput.type = 'text';
      customSealInput.maxLength = 4;
      customSealInput.placeholder = '2-4字名号';
      sealLabel.appendChild?.(customSealInput);

      sealStyleBtn = doc.createElement('button');
      sealStyleBtn.id = 'scroll-seal-style';
      sealStyleBtn.type = 'button';
      sealStyleBtn.textContent = '印式：朱文';

      customRow.appendChild?.(verseLabel);
      customRow.appendChild?.(sealLabel);
      customRow.appendChild?.(sealStyleBtn);

      questSealsRow = doc.createElement('div');
      questSealsRow.id = 'scroll-quest-seals';
      questSealsRow.className = 'scroll-dialog__quest-seals';
      questSealsRow.hidden = true;

      statusEl = doc.createElement('p');
      statusEl.id = 'scroll-status';
      statusEl.className = 'scroll-dialog__status';
      statusEl.setAttribute?.('role', 'status');

      dialogEl.appendChild?.(header);
      dialogEl.appendChild?.(stage);
      dialogEl.appendChild?.(metaRow);
      dialogEl.appendChild?.(sceneCuesEl);
      dialogEl.appendChild?.(customRow);
      dialogEl.appendChild?.(questSealsRow);
      dialogEl.appendChild?.(actions);
      dialogEl.appendChild?.(statusEl);
      doc.body.appendChild?.(dialogEl);
      createdDialogEl = true;
    }

    closeBtn?.addEventListener?.('click', close);
    mountBtn?.addEventListener?.('click', onMountToggleClick);
    styleBtn?.addEventListener?.('click', onStyleCycleClick);
    verseBtn?.addEventListener?.('click', onVerseCycleClick);
    customVerseInput?.addEventListener?.('input', onCustomVerseInput);
    customSealInput?.addEventListener?.('input', onCustomSealInput);
    sealStyleBtn?.addEventListener?.('click', onSealStyleToggleClick);
    saveBtn?.addEventListener?.('click', onSaveBoxClick);
    downloadBtn?.addEventListener?.('click', onDownloadPngClick);
    dialogEl?.addEventListener?.('close', handleDialogClosed);
    dialogEl?.addEventListener?.('click', onDialogBackdropClick);

    // 4. 在不改动 journal.js / index.html 的前提下，为 #journal 无缝挂载第三分页「画匣」
    const journalEl = doc.getElementById?.('journal') || null;
    if (journalEl) {
      tabNotesBtn = doc.getElementById?.('journal-tab-notes') || null;
      tabFieldBtn = doc.getElementById?.('journal-tab-field') || null;
      journalOpenBtn = doc.getElementById?.('journal-open') || null;

      const tabsNav = doc.getElementById?.('journal-tabs') ||
        journalEl.querySelector?.('.journal__tabs') ||
        findDescendant(journalEl, n => typeof n.className === 'string' && n.className.includes('journal__tabs')) ||
        (tabFieldBtn?.parentNode && tabFieldBtn.parentNode !== journalEl ? tabFieldBtn.parentNode : null) ||
        journalEl;

      tabScrollsBtn = doc.getElementById?.('journal-tab-scrolls') || null;
      if (!tabScrollsBtn) {
        tabScrollsBtn = doc.createElement('button');
        tabScrollsBtn.type = 'button';
        tabScrollsBtn.id = 'journal-tab-scrolls';
        tabScrollsBtn.setAttribute?.('aria-pressed', 'false');
        tabScrollsBtn.textContent = '画匣';
        tabsNav?.appendChild?.(tabScrollsBtn);
      }

      journalScrollsSection = doc.getElementById?.('journal-scrolls') || null;
      if (!journalScrollsSection) {
        journalScrollsSection = doc.createElement('div');
        journalScrollsSection.id = 'journal-scrolls';
        journalScrollsSection.className = 'journal__sections';
        journalScrollsSection.hidden = true;

        const bar = doc.createElement('div');
        bar.className = 'scroll-box__bar';
        scrollsCountEl = doc.createElement('span');
        scrollsCountEl.className = 'scroll-box__count';
        const barBtns = doc.createElement('div');
        barBtns.className = 'scroll-card__btns';
        scrollsStitchBtn = doc.createElement('button');
        scrollsStitchBtn.type = 'button';
        scrollsStitchBtn.id = 'journal-scrolls-stitch';
        scrollsStitchBtn.textContent = '合装行旅长卷';
        scrollsStitchBtn.addEventListener?.('click', onStitchScrollsClick);
        scrollsClearBtn = doc.createElement('button');
        scrollsClearBtn.type = 'button';
        scrollsClearBtn.id = 'journal-scrolls-clear';
        scrollsClearBtn.textContent = '清空画匣';
        scrollsClearBtn.addEventListener?.('click', onClearBoxClick);
        barBtns.appendChild?.(scrollsStitchBtn);
        barBtns.appendChild?.(scrollsClearBtn);
        bar.appendChild?.(scrollsCountEl);
        bar.appendChild?.(barBtns);

        scrollsFilterBar = doc.createElement('div');
        scrollsFilterBar.id = 'journal-scrolls-filters';
        scrollsFilterBar.className = 'scroll-box__filters';
        scrollsFilterBar.setAttribute?.('role', 'group');
        scrollsFilterBar.setAttribute?.('aria-label', '按四时筛选画匣');
        scrollsFilterBtns = [];
        for (let i = 0; i < GALLERY_SEASON_TABS.length; i++) {
          const tab = GALLERY_SEASON_TABS[i];
          const fb = doc.createElement('button');
          fb.type = 'button';
          fb.id = 'journal-scrolls-filter-' + tab.id;
          fb.className = 'scroll-box__filter';
          fb.textContent = tab.label;
          fb.setAttribute?.('aria-pressed', String(tab.id === gallerySeasonFilter));
          fb.addEventListener?.('click', () => {
            setGallerySeasonFilter(tab.id);
          });
          scrollsFilterBtns.push(fb);
          scrollsFilterBar.appendChild?.(fb);
        }

        scrollsGridHost = doc.createElement('div');
        scrollsGridHost.id = 'journal-scrolls-list';

        journalScrollsSection.appendChild?.(bar);
        journalScrollsSection.appendChild?.(scrollsFilterBar);
        journalScrollsSection.appendChild?.(scrollsGridHost);

        const footerEl = journalEl.querySelector?.('footer') ||
          findDescendant(journalEl, n => n.tagName === 'FOOTER');
        insertBeforeSafe(journalEl, journalScrollsSection, footerEl);
      }

      tabScrollsBtn?.addEventListener?.('click', selectScrollsTab);
      tabNotesBtn?.addEventListener?.('click', deselectScrollsTab);
      tabFieldBtn?.addEventListener?.('click', deselectScrollsTab);
      journalOpenBtn?.addEventListener?.('click', onJournalOpenRefresh);
      renderJournalGallery();
    }
  }

  win?.addEventListener?.('keydown', onKeyDown, true);

  function getSavedScrolls() {
    return savedScrolls.map(item => ({ ...item }));
  }

  function getStats() {
    const active = currentQueue?.items?.[currentQueuePos] || CLASSICAL_COLOPHONS[currentVerseIdx];
    return {
      open: isOpen(),
      mount: currentMount,
      style: BRUSH_STYLES[currentStyleIdx % BRUSH_STYLES.length].id,
      verseIndex: currentVerseIdx,
      librarySize: CLASSICAL_COLOPHONS.length,
      matchedCount: currentQueue?.strongMatchCount || 0,
      sceneFeatures: snapshotMeta?.sceneProfile?.detectedFeatures || [],
      activeColophonId: active?.id || '',
      savedCount: savedScrolls.length,
      maxSaved: MAX_SAVED_SCROLLS,
      captureCount,
      stitchCount,
      enterWorldCount,
      storageOK,
      storageKey: STORAGE_KEY,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (isOpen()) close();
    win?.removeEventListener?.('keydown', onKeyDown, true);
    openBtn?.removeEventListener?.('click', onOpenBtnClick);
    closeBtn?.removeEventListener?.('click', close);
    mountBtn?.removeEventListener?.('click', onMountToggleClick);
    styleBtn?.removeEventListener?.('click', onStyleCycleClick);
    verseBtn?.removeEventListener?.('click', onVerseCycleClick);
    customVerseInput?.removeEventListener?.('input', onCustomVerseInput);
    customSealInput?.removeEventListener?.('input', onCustomSealInput);
    sealStyleBtn?.removeEventListener?.('click', onSealStyleToggleClick);
    saveBtn?.removeEventListener?.('click', onSaveBoxClick);
    downloadBtn?.removeEventListener?.('click', onDownloadPngClick);
    dialogEl?.removeEventListener?.('close', handleDialogClosed);
    dialogEl?.removeEventListener?.('click', onDialogBackdropClick);
    tabScrollsBtn?.removeEventListener?.('click', selectScrollsTab);
    tabNotesBtn?.removeEventListener?.('click', deselectScrollsTab);
    tabFieldBtn?.removeEventListener?.('click', deselectScrollsTab);
    journalOpenBtn?.removeEventListener?.('click', onJournalOpenRefresh);
    scrollsStitchBtn?.removeEventListener?.('click', onStitchScrollsClick);
    scrollsClearBtn?.removeEventListener?.('click', onClearBoxClick);

    removeElement(tabScrollsBtn);
    removeElement(journalScrollsSection);
    if (createdDialogEl) removeElement(dialogEl);
    if (createdOpenBtn) removeElement(openBtn);
    if (createdStyleEl) removeElement(styleEl);
    doc?.body?.classList?.remove?.('scroll-studio-open');

    if (snapshotCanvas) { snapshotCanvas.width = 0; snapshotCanvas.height = 0; snapshotCanvas = null; }
    if (mountedCanvas) { mountedCanvas.width = 0; mountedCanvas.height = 0; mountedCanvas = null; }

    originalMemCache.clear();
    originalPendingSaves.clear();
    const urlApi = win?.URL || globalThis.URL;
    for (const rec of pendingRevokeTimers) {
      if (rec?.timer) clearTimeout(rec.timer);
      if (rec?.url && typeof urlApi?.revokeObjectURL === 'function') {
        try { urlApi.revokeObjectURL(rec.url); } catch {}
      }
    }
    pendingRevokeTimers.clear();
    closeOriginalDb();
  }

  return {
    openCapture,
    close,
    isOpen,
    setBrushStyle(styleId) {
      const idx = BRUSH_STYLES.findIndex(s => s.id === styleId);
      if (idx < 0) return false;
      currentStyleIdx = idx;
      if (snapshotCanvas) updatePreviewCanvas();
      return true;
    },
    setCustomInscription,
    getCustomInscription,
    getAvailableQuestSeals,
    captureScrollDataUrl,
    downloadSavedScroll,
    removeSavedScroll,
    enterScrollWorld,
    exportPanoramicScroll,
    getSavedScrolls,
    setGallerySeasonFilter,
    getGallerySeasonFilter: () => gallerySeasonFilter,
    clearSavedScrolls,
    getStats,
    dispose
  };
}
