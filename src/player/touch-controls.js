// 移动端触屏漫游控制（仅在粗指针/触屏环境激活：浮动水墨摇杆+外环疾行、右屏轻滑+微惯性观景、随境变化宣纸快捷钮、御风/抚琴/泛舟专属触控）

import { isModalBusy } from '../systems/modal-state.js';

const SERIF = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif';
const STYLE_ID = 'touch-controls-styles';
const PENTATONIC_LABELS = ['宫', '商', '角', '徵', '羽'];

const TOUCH_CSS = `
#touch-controls {
  position: fixed;
  inset: 0;
  z-index: 9;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
}
#touch-stick-zone {
  position: fixed;
  left: 0;
  bottom: 0;
  width: min(44vw, 210px);
  height: min(38vh, 198px);
  pointer-events: auto;
  touch-action: none;
}
#touch-stick {
  position: fixed;
  left: max(14px, env(safe-area-inset-left, 0px) + 10px);
  bottom: max(16px, env(safe-area-inset-bottom, 0px) + 12px);
  width: 108px;
  height: 108px;
  border-radius: 50%;
  background: rgba(244, 237, 222, .44);
  border: 1.5px solid rgba(66, 55, 41, .34);
  box-shadow: 0 4px 18px rgba(24, 20, 15, .14), inset 0 0 0 1px rgba(255, 250, 240, .35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  pointer-events: auto;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color .16s ease, box-shadow .16s ease;
}
#touch-stick.is-sprinting {
  border-color: rgba(164, 58, 46, .76);
  box-shadow: 0 4px 20px rgba(164, 58, 46, .24), inset 0 0 0 2px rgba(164, 58, 46, .28);
}
#touch-stick-hint {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 7px;
  border-radius: 999px;
  font-family: ${SERIF};
  font-size: 10px;
  letter-spacing: .16em;
  color: #faf3e4;
  background: rgba(164, 58, 46, .9);
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  transition: opacity .15s ease;
}
#touch-stick.is-sprinting #touch-stick-hint {
  opacity: 1;
}
#touch-stick-knob {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, rgba(250, 244, 230, .94), rgba(212, 198, 174, .88));
  border: 1px solid rgba(72, 58, 42, .46);
  box-shadow: 0 2px 10px rgba(24, 20, 15, .24);
  transform: translate3d(0, 0, 0);
  pointer-events: none;
}
#touch-actions,
#touch-flight-pad {
  position: fixed;
  right: max(12px, env(safe-area-inset-right, 0px) + 10px);
  bottom: max(16px, env(safe-area-inset-bottom, 0px) + 12px);
  display: grid;
  grid-template-columns: repeat(3, 46px);
  gap: 8px;
  align-items: end;
  justify-items: center;
  pointer-events: auto;
}
#touch-act-drift {
  grid-column: 2 / 4;
  grid-row: 1;
  width: auto;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 12.5px;
  justify-self: end;
}
#touch-act-o { grid-column: 1; grid-row: 2; }
#touch-act-c { grid-column: 2; grid-row: 2; }
#touch-act-g { grid-column: 3; grid-row: 2; }
#touch-act-m { grid-column: 1; grid-row: 3; }
#touch-act-jump { grid-column: 2; grid-row: 3; }
#touch-act-e {
  grid-column: 3;
  grid-row: 3;
  width: 56px;
  height: 56px;
}
#touch-actions .touch-pill small {
  display: none;
}
#touch-flight-pad {
  grid-template-columns: repeat(2, 54px);
  gap: 8px;
}
#touch-flight-pad[hidden] {
  display: none !important;
}
body.touch-active.god-flight #touch-actions {
  display: none !important;
}
.touch-pill {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  font-family: ${SERIF};
  font-size: 14px;
  letter-spacing: .06em;
  color: #241e18;
  background: rgba(244, 237, 222, .90);
  border: 1px solid rgba(66, 55, 41, .34);
  box-shadow: 0 3px 12px rgba(24, 20, 15, .16);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
  padding: 0;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease, background-color .16s ease, border-color .16s ease, color .16s ease;
}
.touch-pill--primary {
  width: 54px;
  height: 54px;
  font-size: 15px;
  font-weight: 600;
}
.touch-pill--fly {
  width: 54px;
  height: 50px;
  border-radius: 16px;
}
.touch-pill--context {
  display: inline-flex;
}
.touch-pill[hidden] {
  display: none !important;
}
.touch-pill.is-context {
  color: #faf3e4;
  background: rgba(164, 58, 46, .92);
  border-color: rgba(138, 42, 32, .95);
  box-shadow: 0 4px 16px rgba(164, 58, 46, .34);
}
.touch-pill.is-active {
  color: #faf3e4;
  background: rgba(58, 102, 92, .94);
  border-color: rgba(42, 78, 70, .96);
}
.touch-pill small {
  font-size: 9px;
  opacity: .72;
  letter-spacing: 0;
  margin-top: 2px;
}
.touch-pill:active {
  transform: scale(0.94);
  background: rgba(232, 219, 194, .96);
  border-color: rgba(164, 58, 46, .58);
}
.touch-pill.is-context:active {
  background: rgba(142, 46, 36, .98);
}

#touch-pentatonic {
  position: fixed;
  left: 50%;
  bottom: max(136px, env(safe-area-inset-bottom, 0px) + 128px);
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(244, 237, 222, .92);
  border: 1px solid rgba(66, 55, 41, .30);
  box-shadow: 0 4px 16px rgba(24, 20, 15, .16);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  pointer-events: auto;
  touch-action: manipulation;
}
#touch-pentatonic[hidden] {
  display: none !important;
}
.touch-note-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid rgba(164, 58, 46, .38);
  background: rgba(252, 246, 234, .94);
  color: #2b231b;
  font-family: ${SERIF};
  font-size: 14px;
  letter-spacing: 0;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease, background-color .14s ease, color .14s ease;
}
.touch-note-btn:active {
  transform: scale(0.92);
  background: rgba(164, 58, 46, .9);
  color: #faf3e4;
}

/* 触屏端自适应避让：隐去键盘键帽与底栏，上下四角各安其位，零遮挡对话与视野 */
body.touch-active #hint { display: none !important; }
body.touch-active #journal-open span,
body.touch-active #scroll-open span,
body.touch-active #guide-open span,
body.touch-active #ui-toggle span,
body.touch-active #view .view__key,
body.touch-active #prompt .key,
body.touch-active .discovery-label kbd,
body.touch-active .talk-reply__key,
body.touch-active .ink-btn span,
body.touch-active .minimap__key {
  display: none !important;
}
body.touch-active #journal-open,
body.touch-active #scroll-open,
body.touch-active #guide-open {
  top: max(10px, env(safe-area-inset-top, 0px) + 6px);
  padding: 6px 10px;
  font-size: 12px;
  letter-spacing: .12em;
  min-height: 32px;
}
body.touch-active #journal-open {
  left: max(10px, env(safe-area-inset-left, 0px) + 8px);
}
body.touch-active #scroll-open {
  left: max(62px, env(safe-area-inset-left, 0px) + 60px);
}
body.touch-active #guide-open {
  left: max(114px, env(safe-area-inset-left, 0px) + 112px);
}
body.touch-active #sky {
  top: max(10px, env(safe-area-inset-top, 0px) + 6px);
  right: max(10px, env(safe-area-inset-right, 0px) + 8px);
}
@media (max-width: 760px) {
  body.touch-active #sky {
    min-width: 0;
    max-width: calc(100vw - 172px);
    padding: 5px 8px 6px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, auto));
    align-items: center;
    gap: 3px 14px;
    font-size: 11px;
    letter-spacing: .08em;
  }
  body.touch-active .sky__modern {
    grid-column: 1 / -1;
    margin: -1px -4px 2px;
    padding: 2px 4px 4px;
    font-size: 10px;
    letter-spacing: .03em;
    text-align: center;
  }
  body.touch-active .sky__row {
    margin: 0 -3px;
    padding: 3px 4px;
    gap: 5px;
    min-height: 24px;
  }
  body.touch-active .sky .key {
    display: none;
  }
}
body.touch-active #hud-footer {
  left: max(10px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 38px);
  bottom: auto;
  max-width: calc(100vw - 120px);
  display: flex;
  gap: 6px;
}
body.touch-active #stats {
  top: calc(100% + 8px);
  bottom: auto;
}
@media (max-width: 760px) {
  body.touch-active #hud-footer {
    max-width: calc(100vw - 178px);
  }
  body.touch-active .hud-footer__meta {
    flex-wrap: wrap;
    gap: 4px;
  }
}
body.touch-active #ui-toggle {
  left: max(10px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 74px);
  bottom: auto;
  padding: 5px 10px;
  font-size: 11.5px;
  letter-spacing: .12em;
}
body.touch-active #minimap {
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 106px);
  right: max(10px, env(safe-area-inset-right, 0px) + 8px);
  bottom: auto;
  width: 82px;
}
@media (min-width: 761px) {
  body.touch-active #minimap {
    top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 158px);
  }
}
body.touch-active #minimap::after { height: calc(82px - 10px); }
body.touch-active #minimap canvas { width: 82px; height: 82px; }
body.touch-active .toast {
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 114px);
  max-width: calc(100vw - 24px);
}
body.touch-active .sky-toast {
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 152px);
  max-width: calc(100vw - 24px);
}
body.touch-active .subtitle {
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 216px);
  right: max(12px, env(safe-area-inset-right, 0px) + 10px);
  max-height: 36dvh;
  font-size: 17px;
  padding: 14px 10px;
}
body.touch-active .classic {
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 112px);
  bottom: auto;
  left: max(10px, env(safe-area-inset-left, 0px) + 8px);
  max-height: 44dvh;
  font-size: 18px;
  padding: 14px 10px;
}
body.touch-active #talk,
body.touch-active .plain,
body.touch-active #mystery-note,
body.touch-active #entry-welcome-guide {
  bottom: max(144px, env(safe-area-inset-bottom, 0px) + 136px);
  max-width: calc(100vw - 28px);
  white-space: normal;
  text-align: center;
}
body.touch-active #talk {
  padding: 11px 16px 13px;
  text-align: left;
}
body.touch-active .talk-reply {
  padding: 7px 12px;
  min-height: 36px;
}
body.touch-active #quiet-notice {
  bottom: max(144px, env(safe-area-inset-bottom, 0px) + 136px);
  max-width: calc(100vw - 28px);
  white-space: normal;
  text-align: center;
}
body.touch-active #quiet-notice.show {
  pointer-events: auto;
  cursor: pointer;
}
body.touch-active #quiet-exit {
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  bottom: max(102px, env(safe-area-inset-bottom, 0px) + 94px);
}
body.touch-active #prompt.show {
  pointer-events: auto;
  cursor: pointer;
  padding: 7px 14px;
}
body.touch-active .discovery-label:not(.discovery-label--hint) {
  pointer-events: auto;
  cursor: pointer;
  padding: .46rem .78rem;
}

@media (max-height: 500px) {
  body.touch-active #journal-open,
  body.touch-active #scroll-open,
  body.touch-active #guide-open,
  body.touch-active #ui-toggle {
    top: max(8px, env(safe-area-inset-top, 0px) + 4px);
    padding: 5px 9px;
    min-height: 28px;
  }
  body.touch-active #journal-open { left: max(10px, env(safe-area-inset-left, 0px) + 8px); }
  body.touch-active #scroll-open { left: max(58px, env(safe-area-inset-left, 0px) + 56px); }
  body.touch-active #guide-open { left: max(106px, env(safe-area-inset-left, 0px) + 104px); }
  body.touch-active #ui-toggle { left: max(154px, env(safe-area-inset-left, 0px) + 152px); }
  body.touch-active #hud-footer {
    top: calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 34px);
    left: max(10px, env(safe-area-inset-left, 0px) + 8px);
    max-width: none;
  }
  body.touch-active #minimap {
    top: calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 68px);
    left: max(10px, env(safe-area-inset-left, 0px) + 8px);
    right: auto;
    bottom: auto;
    width: 74px;
  }
  body.touch-active #minimap::after { height: calc(74px - 10px); }
  body.touch-active #minimap canvas { width: 74px; height: 74px; }
  body.touch-active #touch-stick-zone { width: min(36vw, 180px); height: min(56vh, 170px); }
  body.touch-active #touch-stick { width: 92px; height: 92px; bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); }
  body.touch-active #touch-actions { bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); grid-template-columns: repeat(3, 42px); gap: 6px; }
  body.touch-active #touch-flight-pad { bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); grid-template-columns: repeat(2, 46px); gap: 6px; }
  body.touch-active .touch-pill { width: 42px; height: 42px; font-size: 13px; }
  body.touch-active .touch-pill--primary,
  body.touch-active #touch-act-e { width: 46px; height: 46px; font-size: 14px; }
  body.touch-active #touch-act-drift { height: 30px; font-size: 11.5px; }
  body.touch-active .touch-pill--fly { width: 46px; height: 44px; }
  body.touch-active #touch-pentatonic { bottom: max(68px, env(safe-area-inset-bottom, 0px) + 62px); }
  body.touch-active #talk,
  body.touch-active .plain,
  body.touch-active #mystery-note,
  body.touch-active #quiet-notice,
  body.touch-active #entry-welcome-guide {
    bottom: max(14px, env(safe-area-inset-bottom, 0px) + 10px);
    max-width: min(420px, calc(100vw - 280px));
  }
  body.touch-active #quiet-exit {
    bottom: max(56px, env(safe-area-inset-bottom, 0px) + 50px);
  }
}

body.is-night #touch-stick {
  background: rgba(22, 30, 36, .48);
  border-color: rgba(231, 223, 206, .34);
}
body.is-night #touch-stick.is-sprinting {
  border-color: rgba(240, 196, 136, .76);
  box-shadow: 0 4px 20px rgba(240, 196, 136, .22), inset 0 0 0 2px rgba(240, 196, 136, .24);
}
body.is-night #touch-stick-knob {
  background: radial-gradient(circle at 38% 34%, rgba(64, 78, 88, .92), rgba(28, 38, 46, .92));
  border-color: rgba(231, 223, 206, .42);
}
body.is-night .touch-pill {
  color: #f2ead9;
  background: rgba(20, 27, 33, .88);
  border-color: rgba(231, 223, 206, .34);
}
body.is-night .touch-pill.is-context {
  color: #fff6e6;
  background: rgba(164, 58, 46, .92);
  border-color: rgba(240, 196, 136, .62);
}
body.is-night #touch-pentatonic {
  background: rgba(20, 27, 33, .90);
  border-color: rgba(231, 223, 206, .34);
}
body.is-night .touch-note-btn {
  background: rgba(32, 42, 50, .92);
  color: #f2ead9;
  border-color: rgba(240, 196, 136, .46);
}
body.ui-hidden #touch-controls,
body.map-open #touch-controls,
body.field-guide-open #touch-controls,
body.scroll-studio-open #touch-controls,
body.traveler-guide-open #touch-controls,
body.quest-open #touch-controls,
body.cruise-active #touch-controls,
body.ink-epilogue-open #touch-controls,
body:has(#veil:not(.curtain-gone):not([hidden])):not(.curtain-open) #touch-controls,
body:has(#veil.on) #touch-controls,
body:has(#veil.ink-transition) #touch-controls,
body:has(#veil.ink-epilogue) #touch-controls {
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

const ACTION_BUTTONS = [
  { id: 'touch-act-e', label: '观', key: 'E', code: 'KeyE', title: '近观 / 交谈 / 撑舟', primary: true },
  { id: 'touch-act-jump', label: '跃', key: '空', code: 'Space', title: '轻跃过低障' },
  { id: 'touch-act-g', label: '识', key: 'G', code: 'KeyG', title: '近观识物入图鉴' },
  { id: 'touch-act-m', label: '图', key: 'M', code: 'KeyM', title: '展开舆图' },
  { id: 'touch-act-o', label: '画', key: 'O', code: 'KeyO', title: '丹青画卷' },
  { id: 'touch-act-c', label: '静', key: 'C', code: 'KeyC', title: '驻足静听' },
  { id: 'touch-act-drift', label: '随波', key: 'X', code: 'KeyX', title: '收篙随波 / 重执竹篙', contextOnly: true }
];

const STICK_MAX_R = 44;
const STICK_DEADZONE = 0.12;
const SPRINT_ENTER_NORM = 0.90;
const SPRINT_EXIT_NORM = 0.80;

function findTouch(touchList, id) {
  if (!touchList) return null;
  for (let i = 0; i < touchList.length; i++) {
    if (touchList[i].identifier === id) return touchList[i];
  }
  return null;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function derivePrimaryLabel(promptText, aboardSkiff) {
  if (promptText) {
    if (/敬盏/.test(promptText)) return '敬盏';
    if (/交谈|续谈|问询/.test(promptText)) return '谈';
    if (/登舟/.test(promptText)) return '登舟';
    if (/舍船|登岸/.test(promptText)) return '登岸';
    if (/落座|席|坐/.test(promptText)) return '落座';
    if (/轻抚|唤犬|唤鸡|看鸭|添刍|饲/.test(promptText)) return '抚';
    if (/放流|打水漂/.test(promptText)) return '戏水';
    if (/归程|寻光|重观|立标|系/.test(promptText)) return '应';
  }
  if (aboardSkiff) return '登岸';
  return '观';
}

export function createTouchControls({
  canvas,
  player,
  sound,
  getGodFlight = null,
  getPoeticInteractions = null,
  getRiverSkiff = null,
  getQuiet = null,
  doc = globalThis.document,
  win = globalThis.window,
  forceEnable = false
} = {}) {
  const isTouchEnv = Boolean(
    forceEnable ||
    win?.matchMedia?.('(pointer: coarse)')?.matches ||
    ((win?.navigator?.maxTouchPoints ?? 0) > 0 && (win?.innerWidth ?? 1440) <= 1180)
  );

  let disposed = false;
  let stickTouchId = null;
  let stickFloating = false;
  let lookTouchId = null;
  let stickCenterX = 0;
  let stickCenterY = 0;
  let lookLastX = 0;
  let lookLastY = 0;
  let lookLastTime = 0;
  let lookVelX = 0;
  let lookVelY = 0;
  let lookInertiaRaf = 0;
  let lookInertiaTime = 0;
  let stickX = 0;
  let stickZ = 0;
  let sprinting = false;
  let flyBoostToggle = false;
  let lookEvents = 0;
  let actionPresses = 0;
  let hudSyncTimer = 0;

  let lastPrimaryLabel = '观';
  let lastPrimaryContext = false;
  let lastSeatedJump = false;
  let lastDiscoverContext = false;
  let lastQuietActive = false;
  let lastAboard = false;
  let lastDrifting = false;
  let lastFlying = false;
  let lastPentatonic = false;

  let styleEl = null;
  let rootEl = null;
  let stickZoneEl = null;
  let stickEl = null;
  let stickHintEl = null;
  let knobEl = null;
  let actionsEl = null;
  let flightPadEl = null;
  let pentatonicEl = null;
  let primaryBtn = null;
  let primarySubEl = null;
  let jumpBtn = null;
  let jumpSubEl = null;
  let discoverBtn = null;
  let quietBtn = null;
  let driftBtn = null;
  let flyBoostBtn = null;
  const pillHandlers = [];
  const auxCleanup = [];

  if (!isTouchEnv || !doc?.createElement || !doc?.body) {
    return {
      enabled: false,
      update() {},
      getStats: () => ({
        enabled: false,
        active: false,
        stick: { x: 0, z: 0 },
        sprinting: false,
        lookEvents: 0,
        actionPresses: 0,
        disposed
      }),
      dispose() { disposed = true; }
    };
  }

  function isBlocked() {
    return isModalBusy(doc, {
      includeCruise: true,
      includeUiHidden: true,
      includeVeil: true
    });
  }

  function activeFlight() {
    const gf = typeof getGodFlight === 'function' ? getGodFlight() : getGodFlight;
    return gf && gf.active ? gf : null;
  }

  function cancelLookInertia() {
    if (lookInertiaRaf && typeof win?.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(lookInertiaRaf);
    }
    lookInertiaRaf = 0;
    lookVelX = 0;
    lookVelY = 0;
  }

  function updateStickVisual(dx, dy) {
    if (knobEl?.style) {
      knobEl.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    }
  }

  function setFloatingStickCenter(cx, cy) {
    if (!stickEl?.style) return;
    const vw = win?.innerWidth || 390;
    const vh = win?.innerHeight || 844;
    const half = 54;
    const left = clamp(cx - half, 6, Math.max(6, vw * 0.48 - half * 2));
    const top = clamp(cy - half, Math.max(80, vh * 0.45), Math.max(80, vh - half * 2 - 8));
    stickEl.style.left = `${left.toFixed(0)}px`;
    stickEl.style.top = `${top.toFixed(0)}px`;
    stickEl.style.bottom = 'auto';
    stickCenterX = left + half;
    stickCenterY = top + half;
    stickFloating = true;
  }

  function restoreStickHome() {
    if (!stickFloating || !stickEl?.style) return;
    stickFloating = false;
    stickEl.style.left = '';
    stickEl.style.top = '';
    stickEl.style.bottom = '';
  }

  function syncSprintState(nextSprint) {
    sprinting = Boolean(nextSprint);
    stickEl?.classList?.toggle?.('is-sprinting', sprinting);
    const gf = activeFlight();
    if (gf) {
      gf.setTouchBoost?.(flyBoostToggle || sprinting);
      player?.setTouchSprint?.(false);
    } else {
      player?.setTouchSprint?.(sprinting);
    }
  }

  function applyStickDelta(rawDx, rawDy) {
    const dist = Math.hypot(rawDx, rawDy);
    const clampedDist = Math.min(dist, STICK_MAX_R);
    const scale = dist > 1e-4 ? clampedDist / dist : 0;
    const dx = rawDx * scale;
    const dy = rawDy * scale;
    const norm = clampedDist / STICK_MAX_R;
    if (norm < STICK_DEADZONE) {
      stickX = 0;
      stickZ = 0;
      if (sprinting) syncSprintState(false);
    } else {
      const remapped = (norm - STICK_DEADZONE) / (1 - STICK_DEADZONE);
      // 轻推缓步、满推疾走，避免小指幅微动带来突兀起步
      const curved = remapped * (0.45 + 0.55 * remapped);
      const ux = dx / (clampedDist || 1);
      const uy = dy / (clampedDist || 1);
      stickX = ux * curved;
      stickZ = -uy * curved;
      if (!sprinting && norm >= SPRINT_ENTER_NORM) syncSprintState(true);
      else if (sprinting && norm < SPRINT_EXIT_NORM) syncSprintState(false);
    }
    const gf = activeFlight();
    if (gf) {
      gf.setTouchMove?.(stickX, stickZ);
      player?.setTouchMove?.(0, 0);
    } else {
      player?.setTouchMove?.(stickX, stickZ);
    }
    updateStickVisual(dx, dy);
  }

  function resetStick() {
    stickTouchId = null;
    stickX = 0;
    stickZ = 0;
    sprinting = false;
    stickEl?.classList?.remove?.('is-sprinting');
    player?.setTouchMove?.(0, 0);
    player?.setTouchSprint?.(false);
    const gf = typeof getGodFlight === 'function' ? getGodFlight() : getGodFlight;
    gf?.setTouchMove?.(0, 0);
    gf?.setTouchBoost?.(flyBoostToggle);
    updateStickVisual(0, 0);
    restoreStickHome();
  }

  function onStickStart(e) {
    if (disposed || isBlocked() || stickTouchId !== null) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    e.preventDefault?.();
    sound?.unlock?.();
    stickTouchId = touch.identifier;
    const rect = stickEl.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      stickCenterX = rect.left + rect.width * 0.5;
      stickCenterY = rect.top + rect.height * 0.5;
    } else {
      stickCenterX = touch.clientX;
      stickCenterY = touch.clientY;
    }
    applyStickDelta(touch.clientX - stickCenterX, touch.clientY - stickCenterY);
  }

  function onZoneStart(e) {
    if (disposed || isBlocked() || stickTouchId !== null) return;
    if (e.target === stickEl) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    e.preventDefault?.();
    sound?.unlock?.();
    stickTouchId = touch.identifier;
    setFloatingStickCenter(touch.clientX, touch.clientY);
    applyStickDelta(touch.clientX - stickCenterX, touch.clientY - stickCenterY);
  }

  function onStickMove(e) {
    if (disposed || stickTouchId === null) return;
    const touch = findTouch(e.changedTouches, stickTouchId) || findTouch(e.touches, stickTouchId);
    if (!touch) return;
    e.preventDefault?.();
    if (isBlocked()) { resetStick(); return; }
    applyStickDelta(touch.clientX - stickCenterX, touch.clientY - stickCenterY);
  }

  function onStickEnd(e) {
    if (stickTouchId === null) return;
    const touch = findTouch(e.changedTouches, stickTouchId);
    if (!touch) return;
    e.preventDefault?.();
    resetStick();
  }

  function forwardTouchLook(dx, dy) {
    const gf = activeFlight();
    if (gf) gf.addTouchLook?.(dx, dy);
    else player?.addTouchLook?.(dx, dy);
  }

  function stepLookInertia(ts) {
    if (disposed || isBlocked() || lookTouchId !== null) {
      cancelLookInertia();
      return;
    }
    const now = Number.isFinite(ts) ? ts : nowMs();
    const dt = lookInertiaTime ? clamp((now - lookInertiaTime) / 1000, 0.004, 0.05) : 0.016;
    lookInertiaTime = now;
    forwardTouchLook(lookVelX * dt, lookVelY * dt);
    const decay = Math.exp(-12 * dt);
    lookVelX *= decay;
    lookVelY *= decay;
    if (Math.hypot(lookVelX, lookVelY) < 18) {
      cancelLookInertia();
      return;
    }
    lookInertiaRaf = win.requestAnimationFrame(stepLookInertia);
  }

  function onCanvasTouchStart(e) {
    if (disposed || isBlocked() || lookTouchId !== null) return;
    cancelLookInertia();
    const touches = e.changedTouches || [];
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      if (t.identifier === stickTouchId) continue;
      lookTouchId = t.identifier;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      lookLastTime = nowMs();
      lookVelX = 0;
      lookVelY = 0;
      sound?.unlock?.();
      break;
    }
  }

  function onCanvasTouchMove(e) {
    if (disposed || lookTouchId === null) return;
    const touch = findTouch(e.changedTouches, lookTouchId) || findTouch(e.touches, lookTouchId);
    if (!touch) return;
    if (isBlocked()) { lookTouchId = null; cancelLookInertia(); return; }
    e.preventDefault?.();
    const dx = touch.clientX - lookLastX;
    const dy = touch.clientY - lookLastY;
    const tNow = nowMs();
    const dtSec = (tNow - lookLastTime) / 1000;
    lookLastX = touch.clientX;
    lookLastY = touch.clientY;
    lookLastTime = tNow;
    if (dtSec >= 0.004 && dtSec <= 0.08) {
      const instVx = dx / dtSec;
      const instVy = dy / dtSec;
      lookVelX = lookVelX * 0.35 + instVx * 0.65;
      lookVelY = lookVelY * 0.35 + instVy * 0.65;
    } else {
      lookVelX = 0;
      lookVelY = 0;
    }
    forwardTouchLook(dx, dy);
    lookEvents++;
  }

  function onCanvasTouchEnd(e) {
    if (lookTouchId === null) return;
    const touch = findTouch(e.changedTouches, lookTouchId);
    if (!touch) return;
    lookTouchId = null;
    if (!disposed && !isBlocked() && Math.hypot(lookVelX, lookVelY) > 140 && typeof win?.requestAnimationFrame === 'function') {
      lookInertiaTime = nowMs();
      lookInertiaRaf = win.requestAnimationFrame(stepLookInertia);
    } else {
      lookVelX = 0;
      lookVelY = 0;
    }
  }

  function triggerActionCode(code) {
    if (disposed || isBlocked()) return;
    sound?.unlock?.();
    actionPresses++;
    if (typeof win?.dispatchEvent === 'function') {
      const EvCtor = win.KeyboardEvent || globalThis.KeyboardEvent;
      if (typeof EvCtor === 'function') {
        win.dispatchEvent(new EvCtor('keydown', { code, bubbles: true, cancelable: true }));
        return;
      }
      win.dispatchEvent({ type: 'keydown', code, repeat: false, preventDefault() {} });
    }
  }

  // Mount DOM
  styleEl = doc.getElementById?.(STYLE_ID) || null;
  let createdStyle = false;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = TOUCH_CSS;
    (doc.head || doc.body)?.appendChild?.(styleEl);
    createdStyle = true;
  }

  rootEl = doc.createElement('div');
  rootEl.id = 'touch-controls';
  rootEl.setAttribute?.('aria-label', '触屏漫游控制');

  stickZoneEl = doc.createElement('div');
  stickZoneEl.id = 'touch-stick-zone';
  stickZoneEl.setAttribute?.('aria-hidden', 'true');
  rootEl.appendChild?.(stickZoneEl);

  stickEl = doc.createElement('div');
  stickEl.id = 'touch-stick';
  stickEl.setAttribute?.('aria-hidden', 'true');
  stickHintEl = doc.createElement('span');
  stickHintEl.id = 'touch-stick-hint';
  stickHintEl.textContent = '疾行';
  knobEl = doc.createElement('div');
  knobEl.id = 'touch-stick-knob';
  stickEl.appendChild?.(stickHintEl);
  stickEl.appendChild?.(knobEl);
  rootEl.appendChild?.(stickEl);

  actionsEl = doc.createElement('div');
  actionsEl.id = 'touch-actions';
  for (const cfg of ACTION_BUTTONS) {
    const btn = doc.createElement('button');
    btn.id = cfg.id;
    btn.type = 'button';
    btn.className = 'touch-pill' + (cfg.primary ? ' touch-pill--primary' : '') + (cfg.contextOnly ? ' touch-pill--context' : '');
    btn.title = cfg.title;
    btn.setAttribute?.('aria-label', cfg.title);
    if (cfg.contextOnly) btn.hidden = true;
    const lblSpan = doc.createElement('span');
    lblSpan.textContent = cfg.label;
    const sm = doc.createElement('small');
    sm.textContent = cfg.key;
    btn.appendChild?.(lblSpan);
    btn.appendChild?.(sm);
    if (cfg.id === 'touch-act-e') {
      primaryBtn = btn;
      primarySubEl = lblSpan;
    } else if (cfg.id === 'touch-act-jump') {
      jumpBtn = btn;
      jumpSubEl = lblSpan;
    } else if (cfg.id === 'touch-act-g') {
      discoverBtn = btn;
    } else if (cfg.id === 'touch-act-c') {
      quietBtn = btn;
    } else if (cfg.id === 'touch-act-drift') {
      driftBtn = btn;
    }
    const handler = (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      triggerActionCode(cfg.code);
    };
    btn.addEventListener?.('click', handler);
    pillHandlers.push([btn, handler]);
    actionsEl.appendChild?.(btn);
  }
  rootEl.appendChild?.(actionsEl);

  // God-flight touch pad (ascend, descend, boost, exit)
  flightPadEl = doc.createElement('div');
  flightPadEl.id = 'touch-flight-pad';
  flightPadEl.hidden = true;
  function makeFlightBtn(id, label, sub, title) {
    const btn = doc.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'touch-pill touch-pill--fly';
    btn.title = title;
    btn.setAttribute?.('aria-label', title);
    const sp = doc.createElement('span');
    sp.textContent = label;
    const sm = doc.createElement('small');
    sm.textContent = sub;
    btn.appendChild?.(sp);
    btn.appendChild?.(sm);
    flightPadEl.appendChild?.(btn);
    return btn;
  }
  const flyUpBtn = makeFlightBtn('touch-fly-up', '升', '爬高', '长按拉升高度');
  const flyDownBtn = makeFlightBtn('touch-fly-down', '降', '俯落', '长按降低高度');
  flyBoostBtn = makeFlightBtn('touch-fly-boost', '疾', '加速', '切换御风疾飞');
  const flyExitBtn = makeFlightBtn('touch-fly-exit', '步行', '归地', '退出御风返回步行');

  function bindHoldVertical(btn, dir) {
    const start = (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      sound?.unlock?.();
      btn.classList?.add?.('is-active');
      activeFlight()?.setTouchVertical?.(dir);
    };
    const end = (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      btn.classList?.remove?.('is-active');
      activeFlight()?.setTouchVertical?.(0);
    };
    btn.addEventListener?.('touchstart', start, { passive: false });
    btn.addEventListener?.('touchend', end, { passive: false });
    btn.addEventListener?.('touchcancel', end, { passive: false });
    btn.addEventListener?.('mousedown', start);
    btn.addEventListener?.('mouseup', end);
    btn.addEventListener?.('mouseleave', end);
    auxCleanup.push(() => {
      btn.removeEventListener?.('touchstart', start);
      btn.removeEventListener?.('touchend', end);
      btn.removeEventListener?.('touchcancel', end);
      btn.removeEventListener?.('mousedown', start);
      btn.removeEventListener?.('mouseup', end);
      btn.removeEventListener?.('mouseleave', end);
    });
  }
  bindHoldVertical(flyUpBtn, 1);
  bindHoldVertical(flyDownBtn, -1);

  const onFlyBoostClick = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    flyBoostToggle = !flyBoostToggle;
    flyBoostBtn.classList?.toggle?.('is-active', flyBoostToggle);
    activeFlight()?.setTouchBoost?.(flyBoostToggle || sprinting);
  };
  flyBoostBtn.addEventListener?.('click', onFlyBoostClick);
  auxCleanup.push(() => flyBoostBtn.removeEventListener?.('click', onFlyBoostClick));

  const onFlyExitClick = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    flyBoostToggle = false;
    flyBoostBtn.classList?.remove?.('is-active');
    activeFlight()?.exit?.();
  };
  flyExitBtn.addEventListener?.('click', onFlyExitClick);
  auxCleanup.push(() => flyExitBtn.removeEventListener?.('click', onFlyExitClick));
  rootEl.appendChild?.(flightPadEl);

  // Pentatonic 5-note touch strip (shown when seated or near Cloud Guqin Stone)
  pentatonicEl = doc.createElement('div');
  pentatonicEl.id = 'touch-pentatonic';
  pentatonicEl.hidden = true;
  pentatonicEl.setAttribute?.('aria-label', '五音琴弦');
  for (let i = 0; i < PENTATONIC_LABELS.length; i++) {
    const nBtn = doc.createElement('button');
    nBtn.id = `touch-note-${i + 1}`;
    nBtn.type = 'button';
    nBtn.className = 'touch-note-btn';
    nBtn.textContent = PENTATONIC_LABELS[i];
    const onNoteClick = (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      sound?.unlock?.();
      const poetic = typeof getPoeticInteractions === 'function' ? getPoeticInteractions() : getPoeticInteractions;
      poetic?.playPentatonicNote?.(i);
    };
    nBtn.addEventListener?.('click', onNoteClick);
    auxCleanup.push(() => nBtn.removeEventListener?.('click', onNoteClick));
    pentatonicEl.appendChild?.(nBtn);
  }
  rootEl.appendChild?.(pentatonicEl);

  doc.body.appendChild?.(rootEl);
  doc.body.classList?.add?.('touch-active');

  stickZoneEl.addEventListener?.('touchstart', onZoneStart, { passive: false });
  stickZoneEl.addEventListener?.('touchmove', onStickMove, { passive: false });
  stickZoneEl.addEventListener?.('touchend', onStickEnd, { passive: false });
  stickZoneEl.addEventListener?.('touchcancel', onStickEnd, { passive: false });

  stickEl.addEventListener?.('touchstart', onStickStart, { passive: false });
  stickEl.addEventListener?.('touchmove', onStickMove, { passive: false });
  stickEl.addEventListener?.('touchend', onStickEnd, { passive: false });
  stickEl.addEventListener?.('touchcancel', onStickEnd, { passive: false });

  canvas?.addEventListener?.('touchstart', onCanvasTouchStart, { passive: true });
  canvas?.addEventListener?.('touchmove', onCanvasTouchMove, { passive: false });
  canvas?.addEventListener?.('touchend', onCanvasTouchEnd, { passive: true });
  canvas?.addEventListener?.('touchcancel', onCanvasTouchEnd, { passive: true });

  function update(dt) {
    if (disposed) return;
    hudSyncTimer += Number.isFinite(dt) && dt > 0 ? dt : 0.12;
    if (hudSyncTimer < 0.12) return;
    hudSyncTimer = 0;

    const blocked = isBlocked();
    if (blocked && (stickTouchId !== null || lookTouchId !== null || lookInertiaRaf)) {
      resetStick();
      lookTouchId = null;
      cancelLookInertia();
    }
    const flying = Boolean(activeFlight());
    if (flying !== lastFlying) {
      lastFlying = flying;
      if (flightPadEl) flightPadEl.hidden = !flying;
      if (!flying) {
        flyBoostToggle = false;
        flyBoostBtn?.classList?.remove?.('is-active');
        flyUpBtn.classList?.remove?.('is-active');
        flyDownBtn.classList?.remove?.('is-active');
      }
    }

    const promptEl = doc.getElementById?.('prompt');
    const promptShown = Boolean(promptEl?.classList?.contains?.('show'));
    const promptText = promptShown ? (doc.getElementById?.('prompt-text')?.textContent || '') : '';
    const aboard = Boolean(player?.state?.aboardSkiff);
    const seated = Boolean(player?.state?.seated);

    const nextLabel = derivePrimaryLabel(promptText, aboard);
    if (primarySubEl && nextLabel !== lastPrimaryLabel) {
      lastPrimaryLabel = nextLabel;
      primarySubEl.textContent = nextLabel;
    }
    const nextPrimaryCtx = Boolean(promptShown || aboard);
    if (primaryBtn && nextPrimaryCtx !== lastPrimaryContext) {
      lastPrimaryContext = nextPrimaryCtx;
      primaryBtn.classList?.toggle?.('is-context', nextPrimaryCtx);
    }
    if (seated !== lastSeatedJump) {
      lastSeatedJump = seated;
      if (jumpSubEl) jumpSubEl.textContent = seated ? '起身' : '跃';
      jumpBtn?.classList?.toggle?.('is-context', seated);
    }

    const discEl = doc.getElementById?.('discovery-label');
    const discActive = Boolean(discEl && !discEl.hidden && !discEl.classList?.contains?.('discovery-label--hint'));
    if (discoverBtn && discActive !== lastDiscoverContext) {
      lastDiscoverContext = discActive;
      discoverBtn.classList?.toggle?.('is-context', discActive);
    }

    const quietObj = typeof getQuiet === 'function' ? getQuiet() : getQuiet;
    const quietActive = Boolean(quietObj?.active);
    if (quietBtn && quietActive !== lastQuietActive) {
      lastQuietActive = quietActive;
      quietBtn.classList?.toggle?.('is-active', quietActive);
    }

    const showDrift = Boolean(aboard && !flying);
    if (driftBtn && showDrift !== lastAboard) {
      lastAboard = showDrift;
      driftBtn.hidden = !showDrift;
    }
    const skiffObj = typeof getRiverSkiff === 'function' ? getRiverSkiff() : getRiverSkiff;
    const drifting = Boolean(showDrift && skiffObj?.isDrifting?.());
    if (driftBtn && drifting !== lastDrifting) {
      lastDrifting = drifting;
      driftBtn.classList?.toggle?.('is-active', drifting);
    }

    const talkEl = doc.getElementById?.('talk');
    const talkRepliesOpen = Boolean(talkEl?.classList?.contains?.('show') && talkEl?.classList?.contains?.('has-replies'));
    const poeticObj = typeof getPoeticInteractions === 'function' ? getPoeticInteractions() : getPoeticInteractions;
    const showPentatonic = Boolean(!blocked && !flying && !talkRepliesOpen && poeticObj?.getPentatonicSpot?.());
    if (pentatonicEl && showPentatonic !== lastPentatonic) {
      lastPentatonic = showPentatonic;
      pentatonicEl.hidden = !showPentatonic;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelLookInertia();
    resetStick();
    lookTouchId = null;
    stickZoneEl?.removeEventListener?.('touchstart', onZoneStart);
    stickZoneEl?.removeEventListener?.('touchmove', onStickMove);
    stickZoneEl?.removeEventListener?.('touchend', onStickEnd);
    stickZoneEl?.removeEventListener?.('touchcancel', onStickEnd);
    stickEl?.removeEventListener?.('touchstart', onStickStart);
    stickEl?.removeEventListener?.('touchmove', onStickMove);
    stickEl?.removeEventListener?.('touchend', onStickEnd);
    stickEl?.removeEventListener?.('touchcancel', onStickEnd);
    canvas?.removeEventListener?.('touchstart', onCanvasTouchStart);
    canvas?.removeEventListener?.('touchmove', onCanvasTouchMove);
    canvas?.removeEventListener?.('touchend', onCanvasTouchEnd);
    canvas?.removeEventListener?.('touchcancel', onCanvasTouchEnd);
    for (const [btn, handler] of pillHandlers) btn.removeEventListener?.('click', handler);
    pillHandlers.length = 0;
    for (const fn of auxCleanup) fn();
    auxCleanup.length = 0;
    rootEl?.remove?.();
    doc.body?.classList?.remove?.('touch-active');
    if (createdStyle && styleEl) styleEl.remove?.();
  }

  return {
    enabled: true,
    triggerActionCode,
    update,
    getStats: () => ({
      enabled: true,
      active: stickTouchId !== null || lookTouchId !== null,
      stick: { x: +stickX.toFixed(3), z: +stickZ.toFixed(3) },
      sprinting,
      lookEvents,
      actionPresses,
      disposed
    }),
    dispose
  };
}
