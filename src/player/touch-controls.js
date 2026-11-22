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
  transition: border-color .16s ease, box-shadow .16s ease, opacity .18s ease;
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
  grid-template-columns: 46px 46px 56px;
  gap: 8px;
  align-items: end;
  justify-items: center;
  pointer-events: none;
  touch-action: none;
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
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease, background-color .16s ease, border-color .16s ease, color .16s ease, opacity .18s ease;
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
.touch-pill:active,
.touch-pill.is-pressed {
  transform: scale(0.94);
  background: rgba(232, 219, 194, .96);
  border-color: rgba(164, 58, 46, .58);
}
.touch-pill.is-context:active,
.touch-pill.is-context.is-pressed {
  background: rgba(142, 46, 36, .98);
}
body.is-night .touch-pill:active,
body.is-night .touch-pill.is-pressed {
  background: rgba(38, 50, 60, .96);
  border-color: rgba(240, 196, 136, .62);
}

#touch-pentatonic {
  position: fixed;
  left: 50%;
  bottom: var(--hud-controls-top, max(148px, env(safe-area-inset-bottom, 0px) + 144px));
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
  touch-action: none;
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
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease, background-color .14s ease, color .14s ease;
}
.touch-note-btn:active,
.touch-note-btn.is-pressed {
  transform: scale(0.92);
  background: rgba(164, 58, 46, .9);
  color: #faf3e4;
}

/* 触屏端自适应避让：隐去键盘键帽与底栏，顶/左/右/底分区排布并由动态测距协同零遮挡 */
body.touch-active #hint { display: none !important; }
body.touch-active #journal-open span,
body.touch-active #scroll-open span,
body.touch-active #guide-open span,
body.touch-active #quest-open span,
body.touch-active #hud-top-dock > button span,
body.touch-active #ui-toggle span,
body.touch-active #view .view__key,
body.touch-active #prompt .key,
body.touch-active .discovery-label kbd,
body.touch-active .talk-reply__key,
body.touch-active .ink-btn span,
body.touch-active .minimap__key {
  display: none !important;
}
body.touch-active #hud-top-dock {
  top: max(10px, env(safe-area-inset-top, 0px) + 6px);
  left: max(12px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  gap: 6px;
}
body.touch-active #hud-top-dock > #journal-open,
body.touch-active #hud-top-dock > #scroll-open,
body.touch-active #hud-top-dock > #guide-open,
body.touch-active #hud-top-dock > #quest-open {
  padding: 6px 10px;
  font-size: 12px;
  letter-spacing: .12em;
  min-height: 32px;
}
body.touch-active #sky {
  top: max(10px, env(safe-area-inset-top, 0px) + 6px);
  right: max(12px, env(safe-area-inset-right, 0px) + 8px);
}
@media (max-width: 760px) {
  body.touch-active #sky {
    min-width: 0;
    max-width: calc(100vw - 156px);
    padding: 5px 8px 6px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, auto));
    align-items: center;
    gap: 2px 12px;
    font-size: 11px;
    letter-spacing: .06em;
  }
  body.touch-active .sky__modern {
    grid-column: 1 / -1;
    margin: -1px -4px 2px;
    padding: 2px 4px 4px;
    font-size: 10px;
    letter-spacing: .02em;
    text-align: center;
  }
  body.touch-active .sky__row {
    margin: 0 -3px;
    padding: 2px 4px;
    gap: 5px;
    min-height: 22px;
  }
  body.touch-active .sky .key {
    display: none;
  }
}
body.touch-active #minimap {
  top: var(--hud-sky-bottom, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 158px));
  right: max(12px, env(safe-area-inset-right, 0px) + 8px);
  left: auto;
  bottom: auto;
  width: 82px;
}
body.touch-active #minimap::after { height: calc(82px - 10px); }
body.touch-active #minimap canvas { width: 82px; height: 82px; }
body.touch-active #minimap .minimap__cap {
  padding: 4px 6px 5px;
  font-size: 10px;
  justify-content: center;
}
body.touch-active #hud-footer {
  left: max(12px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  top: var(--hud-dock-bottom, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 42px));
  bottom: auto;
  max-width: var(--hud-left-lane-max, calc(100vw - 200px));
  display: flex;
  gap: 6px;
}
body.touch-active .hud-footer__meta {
  flex-wrap: wrap;
  gap: 4px 6px;
}
body.touch-active #stats {
  top: calc(100% + 8px);
  bottom: auto;
  z-index: 15;
  max-width: calc(100vw - 24px);
}
body.touch-active #ui-toggle {
  left: max(12px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  top: var(--hud-after-footer, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 78px));
  bottom: auto;
  padding: 5px 10px;
  font-size: 11.5px;
  letter-spacing: .1em;
}
body.touch-active.ui-hidden #ui-toggle {
  top: max(10px, env(safe-area-inset-top, 0px) + 6px);
  left: max(10px, env(safe-area-inset-left, 0px) + 6px);
}
body.touch-active #quest-tracker {
  top: var(--hud-after-toggle, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 112px));
  left: max(12px, env(safe-area-inset-left, 0px) + 8px);
  right: auto;
  bottom: auto;
  width: min(256px, var(--hud-quest-exp-max, calc(100vw - 116px)));
  max-width: var(--hud-quest-exp-max, calc(100vw - 116px));
  z-index: 10;
}
body.touch-active #quest-tracker.is-collapsed {
  top: var(--hud-after-toggle, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 112px));
  width: auto;
  max-width: var(--hud-left-lane-max, calc(100vw - 200px));
  z-index: 8;
}
body.touch-active .toast {
  top: var(--hud-toast-top, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 150px));
  max-width: calc(100vw - 24px);
}
body.touch-active .sky-toast,
body.touch-active #quest-toast {
  top: calc(var(--hud-toast-top, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 150px)) + 38px);
  max-width: calc(100vw - 24px);
}
body.touch-active .subtitle {
  top: var(--hud-minimap-bottom, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 254px));
  right: max(12px, env(safe-area-inset-right, 0px) + 8px);
  max-height: min(32dvh, calc(100dvh - var(--hud-minimap-bottom, 260px) - var(--hud-controls-top, 148px) - 10px));
  overflow: hidden;
  font-size: 16.5px;
  padding: 12px 10px;
}
body.touch-active .classic {
  top: var(--hud-left-bottom, calc(max(10px, env(safe-area-inset-top, 0px) + 6px) + 154px));
  bottom: auto;
  left: max(12px, env(safe-area-inset-left, 0px) + 8px);
  max-height: min(34dvh, calc(100dvh - var(--hud-left-bottom, 160px) - var(--hud-controls-top, 148px) - 10px));
  overflow: hidden;
  font-size: 17px;
  padding: 12px 10px;
}
body.touch-active #talk,
body.touch-active .plain,
body.touch-active #mystery-note,
body.touch-active #entry-welcome-guide {
  bottom: var(--hud-controls-top, max(148px, env(safe-area-inset-bottom, 0px) + 144px));
  max-width: calc(100vw - 24px);
  white-space: normal;
  text-align: center;
}
body.touch-active #talk {
  padding: 11px 15px 13px;
  text-align: left;
  max-height: min(34dvh, 240px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
body.touch-active .talk-reply {
  padding: 7px 12px;
  min-height: 36px;
}
body.touch-active #quiet-exit {
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  bottom: var(--hud-controls-top, max(148px, env(safe-area-inset-bottom, 0px) + 144px));
}
body.touch-active #quiet-notice {
  bottom: calc(var(--hud-controls-top, max(148px, env(safe-area-inset-bottom, 0px) + 144px)) + 48px);
  max-width: calc(100vw - 24px);
  white-space: normal;
  text-align: center;
}
body.touch-active #quiet-notice.show {
  pointer-events: auto;
  cursor: pointer;
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

@media (max-width: 600px) and (min-height: 501px) {
  body.touch-active #hud-top-dock {
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    right: max(10px, env(safe-area-inset-right, 0px) + 6px);
    top: max(8px, env(safe-area-inset-top, 0px) + 4px);
    gap: 0;
    display: flex;
    align-items: stretch;
    pointer-events: auto;
    background: rgba(244, 237, 222, .93);
    border: 1px solid rgba(66, 55, 41, .30);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(24, 20, 15, .12);
  }
  body.touch-active.is-night #hud-top-dock {
    background: rgba(20, 27, 33, .90);
    border-color: rgba(231, 223, 206, .32);
  }
  body.touch-active #hud-top-dock > #journal-open,
  body.touch-active #hud-top-dock > #scroll-open,
  body.touch-active #hud-top-dock > #guide-open,
  body.touch-active #hud-top-dock > #quest-open {
    flex: 1 1 0;
    min-width: 0;
    min-height: 32px;
    padding: 5px 4px;
    text-align: center;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    font-size: 11.5px;
    letter-spacing: .1em;
    white-space: nowrap;
  }
  body.touch-active #hud-top-dock > #scroll-open,
  body.touch-active #hud-top-dock > #guide-open,
  body.touch-active #hud-top-dock > #quest-open {
    border-left: 1px solid rgba(66, 55, 41, .18);
  }
  body.touch-active.is-night #hud-top-dock > #scroll-open,
  body.touch-active.is-night #hud-top-dock > #guide-open,
  body.touch-active.is-night #hud-top-dock > #quest-open {
    border-left-color: rgba(231, 223, 206, .20);
  }
  body.touch-active #sky {
    top: var(--hud-dock-bottom, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 42px));
    right: max(10px, env(safe-area-inset-right, 0px) + 6px);
    max-width: calc(100vw - 140px);
    padding: 4px 7px 5px;
    gap: 2px 8px;
    font-size: 10.5px;
    letter-spacing: .04em;
  }
  body.touch-active .sky__modern {
    margin: -1px -3px 2px;
    padding: 1px 3px 3px;
    font-size: 9.5px;
    letter-spacing: .01em;
  }
  body.touch-active .sky__row {
    margin: 0 -2px;
    padding: 2px 3px;
    gap: 4px;
    min-height: 22px;
  }
  body.touch-active .sky__k { font-size: 9.5px; letter-spacing: .04em; }
  body.touch-active .sky__v { min-width: 0; letter-spacing: .04em; }
  body.touch-active #minimap {
    top: var(--hud-sky-bottom, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 136px));
    right: max(10px, env(safe-area-inset-right, 0px) + 6px);
    width: 76px;
    border-radius: 10px;
  }
  body.touch-active #minimap::after { height: calc(76px - 10px); border-radius: 7px; }
  body.touch-active #minimap canvas { width: 76px; height: 76px; }
  body.touch-active #minimap .minimap__cap {
    padding: 3px 6px 4px;
    font-size: 9.5px;
  }
  body.touch-active #hud-footer {
    top: var(--hud-dock-bottom, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 42px));
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    max-width: var(--hud-left-lane-max, calc(100vw - 188px));
  }
  body.touch-active .hud-footer__meta { gap: 4px; }
  body.touch-active #view {
    padding: 3px 6px;
    gap: 4px;
    font-size: 11px;
    letter-spacing: .04em;
  }
  body.touch-active #view .view__k { display: none; }
  body.touch-active #view .view__alt,
  body.touch-active #view .view__fly {
    margin-left: 0;
    padding: 1px 5px;
    font-size: 10px;
    letter-spacing: .04em;
  }
  body.touch-active #fps {
    padding: 3px 6px;
    font-size: 11px;
    gap: 3px;
  }
  body.touch-active #ui-toggle {
    top: var(--hud-after-footer, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 74px));
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    padding: 4px 8px;
    font-size: 11px;
    letter-spacing: .08em;
  }
  body.touch-active.ui-hidden #ui-toggle {
    top: max(8px, env(safe-area-inset-top, 0px) + 4px);
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
  }
  body.touch-active #quest-tracker.is-collapsed {
    top: var(--hud-after-toggle, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 104px));
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    padding: 5px 7px;
    width: auto;
    max-width: var(--hud-left-lane-max, calc(100vw - 188px));
  }
  body.touch-active #quest-tracker.is-collapsed .qtrack__title {
    font-size: 11.5px;
    letter-spacing: .06em;
  }
  body.touch-active #quest-tracker:not(.is-collapsed) {
    top: max(
      var(--hud-after-toggle, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 104px)),
      var(--hud-sky-bottom, calc(max(8px, env(safe-area-inset-top, 0px) + 4px) + 136px))
    );
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    width: min(260px, var(--hud-quest-exp-max, calc(100vw - 104px)));
    max-width: var(--hud-quest-exp-max, calc(100vw - 104px));
    padding: 7px 9px 8px;
  }
}

@media (max-width: 370px) and (min-height: 501px) {
  body.touch-active #touch-stick { width: 94px; height: 94px; }
  body.touch-active #touch-stick-knob { width: 38px; height: 38px; }
  body.touch-active #touch-actions { grid-template-columns: 42px 42px 50px; gap: 6px; }
  body.touch-active .touch-pill { width: 42px; height: 42px; font-size: 13px; }
  body.touch-active .touch-pill--primary,
  body.touch-active #touch-act-e { width: 50px; height: 50px; font-size: 14px; }
}

@media (max-height: 500px) {
  body.touch-active #hud-top-dock {
    top: max(6px, env(safe-area-inset-top, 0px) + 4px);
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    right: auto;
    width: auto;
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    pointer-events: auto;
    background: rgba(244, 237, 222, .93);
    border: 1px solid rgba(66, 55, 41, .30);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(24, 20, 15, .12);
  }
  body.touch-active.is-night #hud-top-dock {
    background: rgba(20, 27, 33, .90);
    border-color: rgba(231, 223, 206, .32);
  }
  body.touch-active #hud-top-dock > #journal-open,
  body.touch-active #hud-top-dock > #scroll-open,
  body.touch-active #hud-top-dock > #guide-open,
  body.touch-active #hud-top-dock > #quest-open {
    flex: 0 0 auto;
    min-height: 28px;
    padding: 4px 10px;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    font-size: 11.5px;
    letter-spacing: .08em;
    white-space: nowrap;
  }
  body.touch-active #hud-top-dock > #scroll-open,
  body.touch-active #hud-top-dock > #guide-open,
  body.touch-active #hud-top-dock > #quest-open {
    border-left: 1px solid rgba(66, 55, 41, .18);
  }
  body.touch-active.is-night #hud-top-dock > #scroll-open,
  body.touch-active.is-night #hud-top-dock > #guide-open,
  body.touch-active.is-night #hud-top-dock > #quest-open {
    border-left-color: rgba(231, 223, 206, .20);
  }
  body.touch-active #ui-toggle {
    top: max(6px, env(safe-area-inset-top, 0px) + 4px);
    left: var(--hud-dock-right, calc(max(10px, env(safe-area-inset-left, 0px) + 6px) + 188px));
    right: auto;
    bottom: auto;
    min-height: 28px;
    padding: 4px 9px;
    font-size: 11px;
    letter-spacing: .08em;
  }
  body.touch-active.ui-hidden #ui-toggle {
    top: max(6px, env(safe-area-inset-top, 0px) + 4px);
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
  }
  body.touch-active #hud-footer {
    top: var(--hud-dock-bottom, calc(max(6px, env(safe-area-inset-top, 0px) + 4px) + 34px));
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    max-width: var(--hud-left-lane-max, 260px);
  }
  body.touch-active #view {
    padding: 2px 6px;
    gap: 4px;
    font-size: 11px;
    letter-spacing: .04em;
  }
  body.touch-active #view .view__k { display: none; }
  body.touch-active #view .view__alt,
  body.touch-active #view .view__fly {
    margin-left: 0;
    padding: 1px 5px;
    font-size: 10px;
  }
  body.touch-active #fps { padding: 2px 6px; font-size: 11px; gap: 3px; }
  body.touch-active #quest-tracker,
  body.touch-active #quest-tracker.is-collapsed {
    top: var(--hud-after-footer, calc(max(6px, env(safe-area-inset-top, 0px) + 4px) + 66px));
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    width: auto;
    max-width: min(230px, 36vw);
    max-height: calc(100dvh - 205px);
    overflow-y: auto;
    padding: 5px 8px;
    z-index: 9;
  }
  body.touch-active #sky {
    top: max(6px, env(safe-area-inset-top, 0px) + 4px);
    right: max(10px, env(safe-area-inset-right, 0px) + 6px);
    min-width: 0;
    max-width: 196px;
    padding: 4px 7px 5px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, auto));
    align-items: center;
    gap: 2px 8px;
    font-size: 10.5px;
    letter-spacing: .04em;
  }
  body.touch-active .sky__modern {
    grid-column: 1 / -1;
    margin: -1px -3px 2px;
    padding: 1px 3px 3px;
    font-size: 9.5px;
    letter-spacing: .01em;
    text-align: center;
  }
  body.touch-active .sky__row {
    margin: 0 -2px;
    padding: 2px 3px;
    gap: 4px;
    min-height: 20px;
  }
  body.touch-active .sky .key { display: none; }
  body.touch-active #minimap {
    top: var(--hud-sky-bottom, calc(max(6px, env(safe-area-inset-top, 0px) + 4px) + 84px));
    right: max(10px, env(safe-area-inset-right, 0px) + 6px);
    left: auto;
    bottom: auto;
    width: 64px;
    border-radius: 9px;
  }
  body.touch-active #minimap::after { height: calc(64px - 10px); border-radius: 6px; }
  body.touch-active #minimap canvas { width: 64px; height: 64px; }
  body.touch-active #minimap .minimap__cap {
    padding: 2px 4px 3px;
    font-size: 9px;
  }
  body.touch-active .toast {
    top: var(--hud-toast-top, 42px);
    max-width: min(320px, calc(100vw - 380px));
  }
  body.touch-active .sky-toast,
  body.touch-active #quest-toast {
    top: calc(var(--hud-toast-top, 42px) + 34px);
    max-width: min(320px, calc(100vw - 380px));
  }
  body.touch-active .subtitle {
    top: var(--hud-sky-bottom, 92px);
    right: max(84px, env(safe-area-inset-right, 0px) + 78px);
    max-height: min(46dvh, calc(100dvh - 208px));
  }
  body.touch-active .classic {
    top: var(--hud-left-bottom, 108px);
    left: max(10px, env(safe-area-inset-left, 0px) + 6px);
    max-height: min(44dvh, calc(100dvh - 220px));
  }
  body.touch-active #touch-stick-zone { width: min(34vw, 172px); height: min(52vh, 156px); }
  body.touch-active #touch-stick { width: 88px; height: 88px; bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); }
  body.touch-active #touch-stick-knob { width: 38px; height: 38px; }
  body.touch-active #touch-actions { bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); grid-template-columns: 42px 42px 46px; gap: 6px; }
  body.touch-active #touch-flight-pad { bottom: max(10px, env(safe-area-inset-bottom, 0px) + 8px); grid-template-columns: repeat(2, 46px); gap: 6px; }
  body.touch-active .touch-pill { width: 42px; height: 42px; font-size: 13px; }
  body.touch-active .touch-pill--primary,
  body.touch-active #touch-act-e { width: 46px; height: 46px; font-size: 14px; }
  body.touch-active #touch-act-drift { height: 30px; font-size: 11.5px; }
  body.touch-active .touch-pill--fly { width: 46px; height: 44px; }
  body.touch-active #touch-pentatonic { bottom: max(58px, env(safe-area-inset-bottom, 0px) + 54px); }
  body.touch-active #talk,
  body.touch-active .plain,
  body.touch-active #mystery-note,
  body.touch-active #entry-welcome-guide {
    bottom: max(12px, env(safe-area-inset-bottom, 0px) + 8px);
    max-width: min(400px, calc(100vw - 290px));
    max-height: 44dvh;
  }
  body.touch-active #quiet-exit {
    bottom: max(12px, env(safe-area-inset-bottom, 0px) + 8px);
  }
  body.touch-active #quiet-notice {
    bottom: max(52px, env(safe-area-inset-bottom, 0px) + 48px);
    max-width: min(400px, calc(100vw - 290px));
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
body.ui-hidden #touch-pentatonic,
body.ui-hidden #touch-act-o,
body.ui-hidden #touch-act-c,
body.ui-hidden #touch-act-g,
body.ui-hidden #touch-act-m,
body.ui-hidden #touch-actions:not(.is-aboard) #touch-act-e,
body.ui-hidden #touch-actions.is-aboard #touch-act-jump {
  display: none !important;
}
body.ui-hidden #touch-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
body.ui-hidden #touch-act-drift {
  order: 1;
}
body.ui-hidden #touch-act-e {
  order: 2;
}
body.touch-active.ui-hidden #touch-stick {
  opacity: 0.48;
}
body.touch-active.ui-hidden #touch-stick.is-active,
body.touch-active.ui-hidden #touch-stick.is-sprinting {
  opacity: 0.92;
}
body.touch-active.ui-hidden #touch-actions .touch-pill,
body.touch-active.ui-hidden #touch-flight-pad .touch-pill {
  opacity: 0.52;
}
body.touch-active.ui-hidden #touch-actions .touch-pill:active,
body.touch-active.ui-hidden #touch-actions .touch-pill.is-pressed,
body.touch-active.ui-hidden #touch-actions .touch-pill.is-active,
body.touch-active.ui-hidden #touch-flight-pad .touch-pill:active,
body.touch-active.ui-hidden #touch-flight-pad .touch-pill.is-pressed,
body.touch-active.ui-hidden #touch-flight-pad .touch-pill.is-active {
  opacity: 0.96;
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

function pickUnusedTouch(touchList, excludeA, excludeB) {
  if (!touchList) return null;
  for (let i = 0; i < touchList.length; i++) {
    const t = touchList[i];
    if (t && t.identifier !== excludeA && t.identifier !== excludeB) return t;
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
  let hudSyncRaf = 0;
  let hudResizeObserver = null;
  let observedSig = '';
  const lastHudVars = Object.create(null);

  let lastPrimaryLabel = '观';
  let lastPrimaryContext = false;
  let lastSeatedJump = false;
  let lastDiscoverContext = false;
  let lastQuietActive = false;
  let lastAboard = false;
  let lastDrifting = false;
  let lastFlying = false;
  let lastPentatonic = false;
  let lastBlocked = false;
  let lastUiHidden = false;
  let lastQuestCollapsed = null;
  let lastHasQuest = false;
  let lastDockCount = 0;
  let lastFpsHidden = null;
  let lastStatsHidden = null;
  let boundDiscEl = null;

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

  function isUiHidden() {
    return Boolean(doc.body?.classList?.contains?.('ui-hidden'));
  }

  function isBlocked() {
    return isModalBusy(doc, {
      includeCruise: true,
      includeUiHidden: false,
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
    stickEl?.classList?.remove?.('is-active');
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
    const touch = pickUnusedTouch(e.changedTouches, lookTouchId, null);
    if (!touch) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    sound?.unlock?.();
    stickTouchId = touch.identifier;
    stickEl?.classList?.add?.('is-active');
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
    if (e.target === stickEl || stickEl.contains?.(e.target)) return;
    const touch = pickUnusedTouch(e.changedTouches, lookTouchId, null);
    if (!touch) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    sound?.unlock?.();
    stickTouchId = touch.identifier;
    stickEl?.classList?.add?.('is-active');
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
    const touch = findTouch(e.changedTouches, stickTouchId) ||
      (e.touches && !findTouch(e.touches, stickTouchId) ? { identifier: stickTouchId } : null);
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
    const t = pickUnusedTouch(e.changedTouches, stickTouchId, null);
    if (!t) return;
    lookTouchId = t.identifier;
    lookLastX = t.clientX;
    lookLastY = t.clientY;
    lookLastTime = nowMs();
    lookVelX = 0;
    lookVelY = 0;
    sound?.unlock?.();
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
    const touch = findTouch(e.changedTouches, lookTouchId) ||
      (e.touches && !findTouch(e.touches, lookTouchId) ? { identifier: lookTouchId } : null);
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

  function isAllowedInUiHidden(code) {
    if (code === 'Space') return true;
    if (player?.state?.aboardSkiff && (code === 'KeyE' || code === 'KeyX')) return true;
    return false;
  }

  function triggerActionCode(code) {
    if (disposed || isBlocked()) return;
    if (isUiHidden() && !isAllowedInUiHidden(code)) return;
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

  function bindTapButton(btn, onActivate) {
    let activeTouchId = null;
    let lastTouchTs = 0;
    const onTouchStart = (ev) => {
      if (disposed) return;
      const list = ev?.changedTouches;
      let picked = null;
      if (list && list.length > 0) {
        picked = pickUnusedTouch(list, stickTouchId, lookTouchId);
        if (!picked) return;
      }
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      activeTouchId = picked ? picked.identifier : -1;
      lastTouchTs = nowMs();
      btn.classList?.add?.('is-pressed');
      onActivate(ev);
    };
    const onTouchEnd = (ev) => {
      if (activeTouchId === null) return;
      const match = activeTouchId === -1 ||
        !ev?.changedTouches ||
        findTouch(ev.changedTouches, activeTouchId) ||
        (ev?.touches && !findTouch(ev.touches, activeTouchId));
      if (!match) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      activeTouchId = null;
      btn.classList?.remove?.('is-pressed');
    };
    const onClick = (ev) => {
      if (disposed) return;
      if (lastTouchTs && nowMs() - lastTouchTs < 500) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      onActivate(ev);
    };
    btn.addEventListener?.('touchstart', onTouchStart, { passive: false });
    btn.addEventListener?.('touchend', onTouchEnd, { passive: false });
    btn.addEventListener?.('touchcancel', onTouchEnd, { passive: false });
    btn.addEventListener?.('click', onClick);
    auxCleanup.push(() => {
      activeTouchId = null;
      btn.classList?.remove?.('is-pressed');
      btn.removeEventListener?.('touchstart', onTouchStart);
      btn.removeEventListener?.('touchend', onTouchEnd);
      btn.removeEventListener?.('touchcancel', onTouchEnd);
      btn.removeEventListener?.('click', onClick);
    });
  }

  function bindWorldTap(el, isReady, onTap) {
    if (!el || typeof el.addEventListener !== 'function') return;
    const onTouchStart = (ev) => {
      if (disposed || !isReady()) return;
      const list = ev?.changedTouches;
      if (list && list.length > 0 && !pickUnusedTouch(list, stickTouchId, lookTouchId)) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      onTap(ev);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    auxCleanup.push(() => el.removeEventListener?.('touchstart', onTouchStart));
  }

  function setHudVar(name, val) {
    if (!doc?.body?.style?.setProperty) return;
    if (lastHudVars[name] === val) return;
    lastHudVars[name] = val;
    doc.body.style.setProperty(name, val);
  }

  function readHudRect(el, vw, vh) {
    if (!el || el.hidden || typeof el.getBoundingClientRect !== 'function') return null;
    const cs = typeof win?.getComputedStyle === 'function' ? win.getComputedStyle(el) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return null;
    const r = el.getBoundingClientRect();
    if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
    if (r.width <= 0 || r.height <= 0) return null;
    // Headless DOM mocks return full-viewport bounds for non-stubbed elements; skip those safely.
    if (r.width >= vw * 0.99 && r.height >= vh * 0.99) return null;
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: Number.isFinite(r.right) ? r.right : r.left + r.width,
      bottom: Number.isFinite(r.bottom) ? r.bottom : r.top + r.height
    };
  }

  function refreshHudObservers() {
    if (!hudResizeObserver) return;
    const targets = [
      doc.getElementById?.('hud-top-dock'),
      doc.getElementById?.('sky'),
      doc.getElementById?.('minimap'),
      doc.getElementById?.('hud-footer'),
      doc.getElementById?.('ui-toggle'),
      doc.getElementById?.('quest-tracker'),
      actionsEl,
      flightPadEl
    ].filter(Boolean);
    const sig = targets.map(t => t.id || t.tagName || 'x').join(',');
    if (sig === observedSig) return;
    observedSig = sig;
    hudResizeObserver.disconnect();
    for (const el of targets) hudResizeObserver.observe(el);
  }

  function syncMobileHudLayout() {
    if (disposed || isBlocked() || isUiHidden()) return;
    refreshHudObservers();
    const vv = win?.visualViewport;
    const vw = (vv && Number.isFinite(vv.width) && vv.width > 0) ? vv.width : (win?.innerWidth || 390);
    const vh = (vv && Number.isFinite(vv.height) && vv.height > 0) ? vv.height : (win?.innerHeight || 844);

    const dockR = readHudRect(doc.getElementById?.('hud-top-dock'), vw, vh);
    const skyR = readHudRect(doc.getElementById?.('sky'), vw, vh);
    const minimapR = readHudRect(doc.getElementById?.('minimap'), vw, vh);
    const footerR = readHudRect(doc.getElementById?.('hud-footer'), vw, vh);
    const toggleR = readHudRect(doc.getElementById?.('ui-toggle'), vw, vh);
    const questR = readHudRect(doc.getElementById?.('quest-tracker'), vw, vh);
    const stickR = readHudRect(stickEl, vw, vh);
    const padR = readHudRect(activeFlight() ? flightPadEl : actionsEl, vw, vh);

    if (dockR) {
      setHudVar('--hud-dock-bottom', `${Math.ceil(dockR.bottom + 6)}px`);
      setHudVar('--hud-dock-right', `${Math.ceil(dockR.right + 6)}px`);
    }
    if (skyR) {
      setHudVar('--hud-sky-bottom', `${Math.ceil(skyR.bottom + 6)}px`);
      const leftOrigin = footerR ? footerR.left : (dockR ? dockR.left : 10);
      setHudVar('--hud-left-lane-max', `${Math.max(118, Math.floor(skyR.left - leftOrigin - 8))}px`);
    }
    if (minimapR) {
      setHudVar('--hud-minimap-bottom', `${Math.ceil(minimapR.bottom + 8)}px`);
      const leftOrigin = questR ? questR.left : (footerR ? footerR.left : 10);
      setHudVar('--hud-quest-exp-max', `${Math.max(176, Math.floor(minimapR.left - leftOrigin - 8))}px`);
    }
    if (footerR) {
      setHudVar('--hud-after-footer', `${Math.ceil(footerR.bottom + 6)}px`);
    }
    if (toggleR) {
      setHudVar('--hud-after-toggle', `${Math.ceil(toggleR.bottom + 6)}px`);
    }
    let leftBottom = 0;
    if (footerR) leftBottom = Math.max(leftBottom, footerR.bottom);
    if (toggleR && vh > 500) leftBottom = Math.max(leftBottom, toggleR.bottom);
    if (questR) leftBottom = Math.max(leftBottom, questR.bottom);
    if (leftBottom > 0) {
      setHudVar('--hud-left-bottom', `${Math.ceil(leftBottom + 8)}px`);
    }

    const ctrlTop = Math.min(stickR ? stickR.top : vh, padR ? padR.top : vh);
    if (ctrlTop < vh) {
      const clearBottom = clamp(Math.ceil(vh - ctrlTop + 14), 106, Math.round(vh * 0.45));
      setHudVar('--hud-controls-top', `${clearBottom}px`);
    }

    if (vh <= 500) {
      const toastTop = dockR ? Math.ceil(dockR.bottom + 6) : 42;
      setHudVar('--hud-toast-top', `${toastTop}px`);
    } else if (minimapR || leftBottom > 0) {
      const base = Math.max(minimapR ? minimapR.bottom + 8 : 0, leftBottom > 0 ? leftBottom + 6 : 0);
      setHudVar('--hud-toast-top', `${Math.min(Math.ceil(base), Math.floor(vh * 0.36))}px`);
    }
  }

  function scheduleHudLayoutSync() {
    if (disposed) return;
    if (typeof win?.requestAnimationFrame !== 'function') {
      syncMobileHudLayout();
      return;
    }
    if (hudSyncRaf) return;
    hudSyncRaf = win.requestAnimationFrame(() => {
      hudSyncRaf = 0;
      syncMobileHudLayout();
    });
  }

  function clearAllTouches() {
    resetStick();
    lookTouchId = null;
    cancelLookInertia();
    const btns = rootEl?.querySelectorAll?.('.is-pressed, .is-active');
    if (btns && typeof btns.length === 'number') {
      for (let i = 0; i < btns.length; i++) {
        btns[i]?.classList?.remove?.('is-pressed');
      }
    }
    flyUpBtn?.classList?.remove?.('is-active');
    flyDownBtn?.classList?.remove?.('is-active');
    activeFlight()?.setTouchVertical?.(0);
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
    bindTapButton(btn, () => triggerActionCode(cfg.code));
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
    let holdTouchId = null;
    let lastTouchTs = 0;
    const onTouchStart = (ev) => {
      if (disposed) return;
      const list = ev?.changedTouches;
      let picked = null;
      if (list && list.length > 0) {
        picked = pickUnusedTouch(list, stickTouchId, lookTouchId);
        if (!picked) return;
      }
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      holdTouchId = picked ? picked.identifier : -1;
      lastTouchTs = nowMs();
      sound?.unlock?.();
      btn.classList?.add?.('is-active');
      activeFlight()?.setTouchVertical?.(dir);
    };
    const onTouchEnd = (ev) => {
      if (holdTouchId === null) return;
      const match = holdTouchId === -1 ||
        !ev?.changedTouches ||
        findTouch(ev.changedTouches, holdTouchId) ||
        (ev?.touches && !findTouch(ev.touches, holdTouchId));
      if (!match) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      holdTouchId = null;
      btn.classList?.remove?.('is-active');
      activeFlight()?.setTouchVertical?.(0);
    };
    const onMouseDown = (ev) => {
      if (disposed || (lastTouchTs && nowMs() - lastTouchTs < 500)) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      sound?.unlock?.();
      btn.classList?.add?.('is-active');
      activeFlight()?.setTouchVertical?.(dir);
    };
    const onMouseEnd = (ev) => {
      if (lastTouchTs && nowMs() - lastTouchTs < 500) return;
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      btn.classList?.remove?.('is-active');
      activeFlight()?.setTouchVertical?.(0);
    };
    btn.addEventListener?.('touchstart', onTouchStart, { passive: false });
    btn.addEventListener?.('touchend', onTouchEnd, { passive: false });
    btn.addEventListener?.('touchcancel', onTouchEnd, { passive: false });
    btn.addEventListener?.('mousedown', onMouseDown);
    btn.addEventListener?.('mouseup', onMouseEnd);
    btn.addEventListener?.('mouseleave', onMouseEnd);
    auxCleanup.push(() => {
      holdTouchId = null;
      btn.classList?.remove?.('is-active');
      btn.removeEventListener?.('touchstart', onTouchStart);
      btn.removeEventListener?.('touchend', onTouchEnd);
      btn.removeEventListener?.('touchcancel', onTouchEnd);
      btn.removeEventListener?.('mousedown', onMouseDown);
      btn.removeEventListener?.('mouseup', onMouseEnd);
      btn.removeEventListener?.('mouseleave', onMouseEnd);
    });
  }
  bindHoldVertical(flyUpBtn, 1);
  bindHoldVertical(flyDownBtn, -1);

  bindTapButton(flyBoostBtn, () => {
    sound?.unlock?.();
    flyBoostToggle = !flyBoostToggle;
    flyBoostBtn.classList?.toggle?.('is-active', flyBoostToggle);
    activeFlight()?.setTouchBoost?.(flyBoostToggle || sprinting);
  });

  bindTapButton(flyExitBtn, () => {
    sound?.unlock?.();
    flyBoostToggle = false;
    flyBoostBtn.classList?.remove?.('is-active');
    activeFlight()?.exit?.();
  });
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
    bindTapButton(nBtn, () => {
      sound?.unlock?.();
      const poetic = typeof getPoeticInteractions === 'function' ? getPoeticInteractions() : getPoeticInteractions;
      poetic?.playPentatonicNote?.(i);
    });
    pentatonicEl.appendChild?.(nBtn);
  }
  rootEl.appendChild?.(pentatonicEl);

  doc.body.appendChild?.(rootEl);
  doc.body.classList?.add?.('touch-active');

  // Direct fast-tap on floating world prompts while holding stick/look
  const promptTapEl = doc.getElementById?.('prompt');
  bindWorldTap(promptTapEl, () => !isUiHidden() && Boolean(promptTapEl?.classList?.contains?.('show')), () => triggerActionCode('KeyE'));
  const quietNoticeTapEl = doc.getElementById?.('quiet-notice');
  bindWorldTap(quietNoticeTapEl, () => !isUiHidden() && Boolean(quietNoticeTapEl?.classList?.contains?.('show')), () => quietNoticeTapEl?.click?.());
  const quietExitTapEl = doc.getElementById?.('quiet-exit');
  bindWorldTap(quietExitTapEl, () => !isUiHidden() && Boolean(quietExitTapEl && !quietExitTapEl.hidden), () => quietExitTapEl?.click?.());

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

  const onVisibilityChange = () => {
    if (doc.hidden) clearAllTouches();
  };
  win?.addEventListener?.('blur', clearAllTouches);
  doc.addEventListener?.('visibilitychange', onVisibilityChange);
  win?.addEventListener?.('resize', scheduleHudLayoutSync);
  win?.addEventListener?.('orientationchange', scheduleHudLayoutSync);
  win?.visualViewport?.addEventListener?.('resize', scheduleHudLayoutSync);
  const ResizeObs = win?.ResizeObserver || globalThis.ResizeObserver;
  if (typeof ResizeObs === 'function') {
    hudResizeObserver = new ResizeObs(() => scheduleHudLayoutSync());
  }
  auxCleanup.push(() => {
    win?.removeEventListener?.('blur', clearAllTouches);
    doc.removeEventListener?.('visibilitychange', onVisibilityChange);
    win?.removeEventListener?.('resize', scheduleHudLayoutSync);
    win?.removeEventListener?.('orientationchange', scheduleHudLayoutSync);
    win?.visualViewport?.removeEventListener?.('resize', scheduleHudLayoutSync);
    if (hudResizeObserver) {
      hudResizeObserver.disconnect();
      hudResizeObserver = null;
    }
  });
  scheduleHudLayoutSync();

  function update(dt) {
    if (disposed) return;
    hudSyncTimer += Number.isFinite(dt) && dt > 0 ? dt : 0.12;
    if (hudSyncTimer < 0.12) return;
    hudSyncTimer = 0;

    let needLayoutSync = false;
    const blocked = isBlocked();
    if (blocked && (stickTouchId !== null || lookTouchId !== null || lookInertiaRaf)) {
      clearAllTouches();
    }
    if (blocked !== lastBlocked) {
      lastBlocked = blocked;
      if (!blocked) needLayoutSync = true;
    }
    const uiHidden = isUiHidden();
    if (uiHidden !== lastUiHidden) {
      lastUiHidden = uiHidden;
      if (!uiHidden) needLayoutSync = true;
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
      needLayoutSync = true;
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
    if (discEl && discEl !== boundDiscEl) {
      boundDiscEl = discEl;
      bindWorldTap(discEl, () => !isUiHidden() && Boolean(discEl && !discEl.hidden && !discEl.classList?.contains?.('discovery-label--hint')), () => triggerActionCode('KeyG'));
    }
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
    if (showDrift !== lastAboard) {
      lastAboard = showDrift;
      if (driftBtn) driftBtn.hidden = !showDrift;
      actionsEl?.classList?.toggle?.('is-aboard', showDrift);
      needLayoutSync = true;
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
    const showPentatonic = Boolean(!blocked && !uiHidden && !flying && !talkRepliesOpen && poeticObj?.getPentatonicSpot?.());
    if (pentatonicEl && showPentatonic !== lastPentatonic) {
      lastPentatonic = showPentatonic;
      pentatonicEl.hidden = !showPentatonic;
    }

    const dockCount = doc.getElementById?.('hud-top-dock')?.children?.length || 0;
    if (dockCount !== lastDockCount) {
      lastDockCount = dockCount;
      needLayoutSync = true;
    }
    const questEl = doc.getElementById?.('quest-tracker');
    const hasQuest = Boolean(questEl);
    const questCollapsed = questEl ? Boolean(questEl.classList?.contains?.('is-collapsed')) : null;
    if (hasQuest !== lastHasQuest || questCollapsed !== lastQuestCollapsed) {
      lastHasQuest = hasQuest;
      lastQuestCollapsed = questCollapsed;
      needLayoutSync = true;
    }
    const fpsHidden = Boolean(doc.getElementById?.('fps')?.hidden);
    const statsHidden = Boolean(doc.getElementById?.('stats')?.hidden);
    if (fpsHidden !== lastFpsHidden || statsHidden !== lastStatsHidden) {
      lastFpsHidden = fpsHidden;
      lastStatsHidden = statsHidden;
      needLayoutSync = true;
    }
    if (needLayoutSync && !blocked && !uiHidden) scheduleHudLayoutSync();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (hudSyncRaf && typeof win?.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(hudSyncRaf);
      hudSyncRaf = 0;
    }
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
    for (const fn of auxCleanup) fn();
    auxCleanup.length = 0;
    for (const k of Object.keys(lastHudVars)) {
      doc.body?.style?.removeProperty?.(k);
      delete lastHudVars[k];
    }
    rootEl?.remove?.();
    doc.body?.classList?.remove?.('touch-active');
    if (createdStyle && styleEl) styleEl.remove?.();
  }

  return {
    enabled: true,
    triggerActionCode,
    syncLayout: syncMobileHudLayout,
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
