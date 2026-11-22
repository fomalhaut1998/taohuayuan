// 桃源简册（Q 键）：主线行记与乡邻支线托付（水墨轻引风 · 落英/夜萤寻津联动 · 零热路径分配）
import questsConfig from '../data/quests.json' with { type: 'json' };
import { isModalBusy as sharedIsModalBusy } from './modal-state.js';

const SERIF = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif';
const STYLE_ID = 'quest-system-styles';
const DEFAULT_STORAGE_KEY = questsConfig.storageKey || 'taohua.quests.v1';

const QUEST_CSS = `
#quest-open {
  position: fixed;
  left: 248px;
  top: 18px;
  z-index: 8;
  padding: 8px 12px;
  font-family: ${SERIF};
  font-size: 13px;
  line-height: normal;
  letter-spacing: .16em;
  color: #221d17;
  background: rgba(244, 237, 222, .92);
  border: 1px solid rgba(66, 55, 41, .3);
  border-radius: 2px;
  box-shadow: 0 2px 10px rgba(24, 20, 15, .12);
  cursor: pointer;
  transition: background-color .2s ease, border-color .2s ease, color .35s ease;
}
#quest-open span { font-size: 10px; opacity: .76; letter-spacing: 0; }
#quest-open:hover { background: rgba(235, 224, 200, .98); border-color: rgba(164, 58, 46, .48); }
#quest-open:focus-visible { outline: 2px solid #a44f40; outline-offset: 3px; }
body.is-night #quest-open {
  color: #f2ead9;
  background: rgba(20, 27, 33, .90);
  border-color: rgba(231, 223, 206, .32);
}
body.is-night #quest-open:hover {
  background: rgba(34, 44, 52, .94);
  border-color: rgba(240, 196, 136, .55);
}

#quest-tracker {
  position: fixed;
  left: 16px;
  top: 62px;
  z-index: 7;
  max-width: 248px;
  padding: 9px 11px 10px;
  font-family: ${SERIF};
  color: #262018;
  background: rgba(244, 237, 222, .92);
  border: 1px solid rgba(72, 60, 44, .28);
  border-radius: 2px;
  box-shadow: 0 6px 20px rgba(24, 20, 15, .12);
  transition: background-color .25s ease, border-color .25s ease, color .35s ease;
}
body.is-night #quest-tracker {
  color: #f2ead9;
  background: rgba(20, 27, 33, .90);
  border-color: rgba(231, 223, 206, .30);
}
#quest-tracker[hidden] { display: none !important; }
.qtrack__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.qtrack__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.qtrack__kind {
  flex: none;
  padding: 1px 5px;
  font-size: 10px;
  letter-spacing: .1em;
  border-radius: 2px;
  color: #faf3e4;
  background: #a43a2e;
}
.qtrack__kind.is-side {
  background: #3d6359;
}
.qtrack__title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .12em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qtrack__collapse {
  flex: none;
  padding: 2px 6px;
  font: inherit;
  font-size: 10.5px;
  letter-spacing: .08em;
  color: #4e4334;
  background: rgba(255, 251, 242, .62);
  border: 1px solid rgba(78, 67, 52, .24);
  border-radius: 2px;
  cursor: pointer;
}
body.is-night .qtrack__collapse {
  color: #e6dcc8;
  background: rgba(34, 44, 52, .82);
  border-color: rgba(231, 223, 206, .26);
}
.qtrack__body {
  margin-top: 6px;
}
#quest-tracker.is-collapsed .qtrack__body {
  display: none;
}
.qtrack__step {
  font-size: 11.5px;
  color: #8f3126;
  letter-spacing: .1em;
  margin-bottom: 3px;
}
body.is-night .qtrack__step {
  color: #f0be96;
}
.qtrack__clue {
  font-size: 12px;
  line-height: 1.55;
  color: #2f2820;
  letter-spacing: .04em;
}
body.is-night .qtrack__clue {
  color: #ece3d0;
}
.qtrack__foot {
  margin-top: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.qtrack__dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qtrack__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(78, 67, 52, .24);
  border: 1px solid rgba(78, 67, 52, .35);
}
.qtrack__dot.is-done {
  background: #a43a2e;
  border-color: #8f2d22;
}
.qtrack__dot.is-cur {
  background: #4a7c6f;
  border-color: #365d53;
  transform: scale(1.18);
}
body.is-night .qtrack__dot {
  background: rgba(231, 223, 206, .18);
  border-color: rgba(231, 223, 206, .34);
}
body.is-night .qtrack__dot.is-done {
  background: #df8272;
  border-color: #df8272;
}
body.is-night .qtrack__dot.is-cur {
  background: #84c0b0;
  border-color: #84c0b0;
}
.qtrack__actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.qtrack__btn {
  padding: 2px 7px;
  font: inherit;
  font-size: 11px;
  letter-spacing: .1em;
  color: #2f271e;
  background: rgba(250, 244, 232, .82);
  border: 1px solid rgba(90, 76, 56, .32);
  border-radius: 2px;
  cursor: pointer;
}
.qtrack__btn.is-active {
  color: #faf3e4;
  background: #3d6359;
  border-color: #2e4d45;
}
body.is-night .qtrack__btn {
  color: #f2ead9;
  background: rgba(34, 44, 52, .88);
  border-color: rgba(231, 223, 206, .28);
}
body.is-night .qtrack__btn.is-active {
  background: #4a7c6f;
  color: #fffaf0;
}

#quest-toast {
  position: fixed;
  left: 50%;
  top: 14vh;
  transform: translate(-50%, -6px);
  z-index: 30;
  max-width: min(460px, 86vw);
  padding: 7px 18px 8px;
  font-family: ${SERIF};
  font-size: 13px;
  letter-spacing: .14em;
  color: #221d17;
  background: rgba(244, 237, 222, .94);
  border: 1px solid rgba(164, 58, 46, .34);
  border-radius: 3px;
  box-shadow: 0 6px 20px rgba(24, 20, 15, .16);
  opacity: 0;
  pointer-events: none;
  user-select: none;
  transition: opacity .45s ease, transform .45s ease;
}
#quest-toast.show {
  opacity: .98;
  transform: translate(-50%, 0);
}
body.is-night #quest-toast {
  color: #f2ead9;
  background: rgba(20, 27, 33, .92);
  border-color: rgba(240, 196, 136, .42);
}

#quest-dialog {
  position: fixed;
  margin: auto;
  width: min(860px, 93vw);
  max-height: min(86vh, 780px);
  overflow: auto;
  padding: clamp(18px, 3vw, 28px);
  color: #2f2a24;
  background: #f3ebda;
  border: 1px solid #a99a81;
  box-shadow: 0 22px 76px rgba(23, 26, 24, .54);
  font-family: ${SERIF};
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 112, 88, 0.44) transparent;
}
#quest-dialog::-webkit-scrollbar { width: 5px; height: 5px; }
#quest-dialog::-webkit-scrollbar-thumb { background: rgba(128, 112, 88, 0.42); border-radius: 999px; }
#quest-dialog::-webkit-scrollbar-track { background: transparent; }
#quest-dialog::backdrop { background: rgba(25, 31, 27, .58); }
.quest__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid #b5a68e;
  padding-bottom: 12px;
}
.quest__eyebrow { color: #a43a2e; font-size: 11px; letter-spacing: .28em; }
.quest__head h2 { font-size: 24px; font-weight: normal; letter-spacing: .22em; margin-top: 4px; }
.quest__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.quest__tab {
  padding: 6px 14px;
  font: inherit;
  font-size: 13px;
  letter-spacing: .16em;
  color: #3d352c;
  background: rgba(248, 241, 227, .82);
  border: 1px solid rgba(154, 138, 114, .44);
  cursor: pointer;
}
.quest__tab[aria-pressed="true"] {
  color: #faf3e4;
  background: #a43a2e;
  border-color: #8f2d22;
}
.quest__panel { margin-top: 16px; }
.quest__panel[hidden] { display: none; }
.quest__banner {
  padding: 12px 14px;
  background: rgba(250, 244, 232, .72);
  border: 1px solid rgba(154, 138, 114, .36);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.quest__banner h3 {
  font-size: 17px;
  font-weight: normal;
  letter-spacing: .18em;
  color: #241f1a;
}
.quest__banner p {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #5b4f41;
}
.quest__btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
#quest-dialog button.quest__btn {
  font: inherit;
  font-size: 12.5px;
  letter-spacing: .14em;
  color: #2f2a24;
  background: rgba(248, 241, 227, .9);
  border: 1px solid #b5a48a;
  padding: 6px 12px;
  cursor: pointer;
}
#quest-dialog button.quest__btn:hover {
  border-color: #a43a2e;
  background: rgba(242, 232, 212, .98);
}
#quest-dialog button.quest__btn.is-primary {
  background: rgba(164, 58, 46, .92);
  color: #faf3e4;
  border-color: #8f2d22;
}
#quest-dialog button.quest__btn.is-way {
  background: #3d6359;
  color: #faf3e4;
  border-color: #2e4d45;
}
.quest__timeline {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.quest__step-item {
  padding: 11px 14px;
  background: rgba(250, 244, 232, .64);
  border: 1px solid rgba(154, 138, 114, .34);
  border-left: 3px solid rgba(154, 138, 114, .5);
}
.quest__step-item.is-done {
  border-left-color: #4a7c6f;
  background: rgba(246, 241, 230, .54);
}
.quest__step-item.is-cur {
  border-left-color: #a43a2e;
  background: rgba(255, 250, 240, .86);
}
.quest__step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.quest__step-act {
  font-size: 11px;
  color: #7c6d59;
  letter-spacing: .16em;
}
.quest__step-title {
  margin-top: 2px;
  font-size: 15px;
  letter-spacing: .14em;
  color: #241f1a;
}
.quest__badge {
  flex: none;
  padding: 2px 7px;
  font-size: 11px;
  letter-spacing: .12em;
  border: 1px solid rgba(124, 109, 89, .32);
  color: #5f5343;
}
.quest__badge.is-done {
  color: #2e594d;
  border-color: rgba(74, 124, 111, .45);
  background: rgba(74, 124, 111, .09);
}
.quest__badge.is-cur {
  color: #a43a2e;
  border-color: rgba(164, 58, 46, .45);
  background: rgba(164, 58, 46, .08);
}
.quest__classic {
  margin-top: 6px;
  font-size: 13px;
  color: #3a3126;
  letter-spacing: .08em;
}
.quest__clue {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.65;
  color: #5b5042;
}
.quest__group-title {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: normal;
  color: #a43a2e;
  letter-spacing: .22em;
  border-bottom: 1px dashed rgba(154, 138, 114, .44);
  padding-bottom: 5px;
}
.quest__group-title:first-child { margin-top: 0; }
.quest__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}
.quest__card {
  padding: 12px 14px;
  background: rgba(250, 244, 232, .68);
  border: 1px solid rgba(154, 138, 114, .36);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
}
.quest__card.is-completed {
  background: rgba(246, 242, 231, .56);
  border-color: rgba(74, 124, 111, .38);
}
.quest__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.quest__card-title {
  font-size: 15px;
  letter-spacing: .16em;
  color: #241f1a;
}
.quest__card-giver {
  margin-top: 2px;
  font-size: 11.5px;
  color: #776754;
  letter-spacing: .1em;
}
.quest__card-desc {
  margin-top: 7px;
  font-size: 12.5px;
  line-height: 1.65;
  color: #443a2e;
}
.quest__substeps {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 5px;
  font-size: 12px;
  line-height: 1.55;
  color: #4f4437;
}
.quest__substeps li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.quest__subdot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  border: 1px solid rgba(124, 109, 89, .55);
}
.quest__substeps li.is-done .quest__subdot {
  background: #4a7c6f;
  border-color: #4a7c6f;
}
.quest__substeps li.is-done {
  color: #2e594d;
}
.quest__seal-inline {
  display: inline-block;
  padding: 2px 7px;
  font-size: 11px;
  letter-spacing: .14em;
  color: #faf3e4;
  background: #a43a2e;
  border-radius: 2px;
}
.quest__seals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}
.quest__seal-card {
  padding: 14px;
  background: rgba(250, 244, 232, .74);
  border: 1px solid rgba(164, 58, 46, .28);
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.quest__seal-stamp {
  flex: none;
  width: 46px;
  min-height: 46px;
  padding: 4px;
  display: grid;
  place-items: center;
  text-align: center;
  font-size: 13px;
  line-height: 1.25;
  letter-spacing: .08em;
  color: #faf3e4;
  background: #a43a2e;
  border: 1px solid #86291e;
  border-radius: 3px;
}
.quest__seal-title {
  font-size: 14px;
  letter-spacing: .16em;
  color: #241f1a;
}
.quest__seal-text {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #4f4437;
}
.quest__empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
  color: #6b5e4d;
  background: rgba(250, 244, 232, .52);
  border: 1px dashed rgba(154, 138, 114, .42);
}
.quest__foot {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #cbbda5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  color: #6b5e4d;
}

body.map-open #quest-open,
body.ui-hidden #quest-open,
body.field-guide-open #quest-open,
body.ink-epilogue-open #quest-open,
body.scroll-studio-open #quest-open,
body.traveler-guide-open #quest-open,
body.quest-open #quest-open,
body.cruise-active #quest-open,
body:has(#journal[open]) #quest-open,
body:has(#veil:not(.curtain-gone):not([hidden])):not(.curtain-open) #quest-open,
body:has(#veil.on) #quest-open,
body:has(#veil.ink-transition) #quest-open,
body:has(#veil.ink-epilogue) #quest-open,
body.map-open #quest-tracker,
body.ui-hidden #quest-tracker,
body.field-guide-open #quest-tracker,
body.ink-epilogue-open #quest-tracker,
body.scroll-studio-open #quest-tracker,
body.traveler-guide-open #quest-tracker,
body.quest-open #quest-tracker,
body.god-flight #quest-tracker,
body.cruise-active #quest-tracker,
body:has(#journal[open]) #quest-tracker,
body:has(#veil:not(.curtain-gone):not([hidden])):not(.curtain-open) #quest-tracker,
body:has(#veil.on) #quest-tracker,
body:has(#veil.ink-transition) #quest-tracker,
body:has(#veil.ink-epilogue) #quest-tracker {
  visibility: hidden !important;
  pointer-events: none !important;
}

@media (max-width: 900px) {
  #quest-open { top: 14px; left: 230px; }
  #quest-tracker { top: 56px; left: 14px; max-width: 232px; }
}
@media (max-width: 600px) {
  #quest-open { top: 12px; left: 210px; padding: 6px 9px; font-size: 12px; letter-spacing: .1em; }
  #quest-tracker { top: 48px; left: 12px; max-width: min(226px, calc(100vw - 24px)); padding: 7px 9px; }
  #quest-dialog {
    width: calc(100vw - 18px);
    max-height: 88dvh;
    padding: 16px 14px 12px;
    border-radius: 10px;
    overscroll-behavior: contain;
  }
  .quest__head h2 { font-size: 20px; }
  .quest__cards, .quest__seals-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  #quest-open { top: 12px; left: 192px; padding: 6px 8px; font-size: 11.5px; letter-spacing: .08em; }
  #quest-tracker {
    top: calc(max(8px, env(safe-area-inset-top, 0px)) + 98px);
    left: 10px;
    width: min(268px, calc(100vw - 20px));
    max-width: calc(100vw - 20px);
    z-index: 9;
  }
  #quest-tracker.is-collapsed {
    top: calc(max(8px, env(safe-area-inset-top, 0px)) + 42px);
    width: auto;
    max-width: calc(100vw - 186px);
  }
}
@media (max-height: 540px) {
  #quest-open { top: 10px; padding: 6px 10px; }
  #quest-tracker { top: 46px; padding: 6px 9px; }
}
.quest__seal-actions {
  margin-top: 8px;
}
`;

const CATEGORY_ORDER = [
  { id: 'neighbor', label: '乡邻托付' },
  { id: 'lore', label: '风物传闻' },
  { id: 'season', label: '四时雅集' }
];

const MAIN_QUEST = questsConfig.main;
const SIDE_QUESTS = Array.isArray(questsConfig.sides) ? questsConfig.sides : [];
const QUEST_BY_ID = new Map();
QUEST_BY_ID.set(MAIN_QUEST.id, MAIN_QUEST);
for (const q of SIDE_QUESTS) QUEST_BY_ID.set(q.id, q);

function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  if (typeof target.closest === 'function') {
    if (target.closest('input, textarea, select, button, a[href], [contenteditable]')) return true;
  }
  return false;
}

export function createQuestSystem(options = {}) {
  const {
    world = null,
    player = null,
    canvas = null,
    sky = null,
    map = null,
    journal = null,
    dialogue = null,
    act3Finale = null,
    easterEggs = null,
    hospitalityFeast = null,
    qinHanHomestead = null,
    qinHanCompletion = null,
    waterworks = null,
    leisureGrove = null,
    oxPlowing = null,
    poeticInteractions = null,
    situationalRest = null,
    villagerDialogue = null,
    mysteries = null,
    quiet = null,
    sound = null,
    getPhenology = null,
    getGodFlight = null,
    getScrollStudio = null,
    getTravelerGuide = null,
    doc = globalThis.document,
    win = globalThis.window,
    storage = globalThis.localStorage,
    storageKey = DEFAULT_STORAGE_KEY
  } = options;

  let disposed = false;
  let simTimer = 0;
  let toastTimer = null;
  let returnFocus = null;
  let wasLocked = false;
  let suppressCloseRestore = false;
  let activeTab = 'main';
  let trackerCollapsed = Boolean(win?.innerWidth && win.innerWidth <= 600);
  let lastTrackerSig = '';

  const pavilionReg = leisureGrove?.layout?.regions?.find?.(r => r?.kind === 'pavilion') || null;
  // Pre-cached dynamic world anchors (zero per-frame lookup/alloc)
  const anchors = {
    hospitalityFeast: hospitalityFeast?.layout?.site
      ? { x: hospitalityFeast.layout.site.x, z: hospitalityFeast.layout.site.z }
      : { x: 22, z: -60 },
    weaving: qinHanHomestead?.layout?.weaving
      ? { x: qinHanHomestead.layout.weaving.x, z: qinHanHomestead.layout.weaving.z }
      : { x: 42, z: -120 },
    carpentry: qinHanHomestead?.layout?.carpentry
      ? { x: qinHanHomestead.layout.carpentry.x, z: qinHanHomestead.layout.carpentry.z }
      : { x: 36, z: -136 },
    hearth: qinHanHomestead?.layout?.hearth
      ? { x: qinHanHomestead.layout.hearth.x, z: qinHanHomestead.layout.hearth.z }
      : { x: 38, z: -108 },
    waterworks: waterworks?.layout?.wheels?.[0]
      ? { x: waterworks.layout.wheels[0].x, z: waterworks.layout.wheels[0].z }
      : { x: 112, z: -82 },
    oxPlowing: oxPlowing?.targets?.[0]
      ? { x: oxPlowing.targets[0].x, z: oxPlowing.targets[0].z }
      : { x: 56, z: -84 },
    pavilion: pavilionReg && Number.isFinite(pavilionReg.x) && Number.isFinite(pavilionReg.z)
      ? { x: pavilionReg.x, z: pavilionReg.z }
      : { x: 58, z: -130 },
    eggs: Object.create(null)
  };
  for (const s of easterEggs?.sites || []) {
    if (s?.id && Number.isFinite(s.x) && Number.isFinite(s.z)) {
      anchors.eggs[s.id] = { x: s.x, z: s.z };
    }
  }

  // Zero-alloc cached journal sets & main-step flags
  const knownClassics = new Set();
  const knownVisited = new Set();
  const mainDoneFlags = new Uint8Array(MAIN_QUEST.steps.length);
  function syncJournalCaches() {
    knownClassics.clear();
    knownVisited.clear();
    const cls = journal?.classics?.();
    if (Array.isArray(cls)) {
      for (let i = 0; i < cls.length; i++) knownClassics.add(cls[i]);
    }
    const vis = journal?.visited?.();
    if (Array.isArray(vis)) {
      for (let i = 0; i < vis.length; i++) knownVisited.add(vis[i]);
    }
  }
  syncJournalCaches();

  function playQuestNote(kind) {
    try {
      const px = player?.state?.x ?? 0;
      const pz = player?.state?.z ?? 0;
      if (kind === 'accept') sound?.guqinPluck?.(px, pz, 0);
      else if (kind === 'step') sound?.guqinPluck?.(px, pz, 1);
      else if (kind === 'complete') sound?.guqinPluck?.(px, pz, 2);
    } catch (_) {}
  }

  function playSealPluck() {
    playQuestNote('complete');
  }

  // Persistent state
  const state = {
    mainStep: 0,
    mainCompleted: false,
    trackedId: MAIN_QUEST.id,
    wayfinderQuestId: null,
    trackerCollapsed,
    sides: Object.create(null)
  };

  function makeEmptySideRecord() {
    return {
      status: 'available', // 'available' | 'active' | 'completed'
      doneSteps: new Set(),
      talkedComplete: false
    };
  }
  for (const q of SIDE_QUESTS) {
    state.sides[q.id] = makeEmptySideRecord();
  }

  function loadStorage() {
    if (!storage?.getItem) return;
    try {
      const raw = JSON.parse(storage.getItem(storageKey) || 'null');
      if (!raw || typeof raw !== 'object') return;
      if (Number.isInteger(raw.mainStep) && raw.mainStep >= 0 && raw.mainStep <= MAIN_QUEST.steps.length) {
        state.mainStep = raw.mainStep;
      }
      state.mainCompleted = Boolean(raw.mainCompleted) || state.mainStep >= MAIN_QUEST.steps.length;
      if (typeof raw.trackedId === 'string' && QUEST_BY_ID.has(raw.trackedId)) {
        state.trackedId = raw.trackedId;
      }
      if (typeof raw.trackerCollapsed === 'boolean') {
        trackerCollapsed = raw.trackerCollapsed;
        state.trackerCollapsed = raw.trackerCollapsed;
      }
      if (raw.sides && typeof raw.sides === 'object') {
        for (const q of SIDE_QUESTS) {
          const saved = raw.sides[q.id];
          if (!saved || typeof saved !== 'object') continue;
          const rec = state.sides[q.id];
          if (saved.status === 'active' || saved.status === 'completed') rec.status = saved.status;
          const validStepIds = new Set(q.steps.map(s => s.id));
          if (Array.isArray(saved.doneSteps)) {
            for (const sid of saved.doneSteps) {
              if (validStepIds.has(sid)) rec.doneSteps.add(sid);
            }
          }
          rec.talkedComplete = Boolean(saved.talkedComplete);
          if (rec.status === 'completed') {
            for (const s of q.steps) rec.doneSteps.add(s.id);
          }
        }
      }
    } catch (_) {
      /* 存储受限或损坏时静默回退默认状态 */
    }
  }

  function saveStorage() {
    if (!storage?.setItem) return;
    try {
      const sidesOut = {};
      for (const q of SIDE_QUESTS) {
        const rec = state.sides[q.id];
        sidesOut[q.id] = {
          status: rec.status,
          doneSteps: Array.from(rec.doneSteps),
          talkedComplete: rec.talkedComplete
        };
      }
      storage.setItem(storageKey, JSON.stringify({
        mainStep: state.mainStep,
        mainCompleted: state.mainCompleted,
        trackedId: state.trackedId,
        trackerCollapsed,
        sides: sidesOut
      }));
    } catch (_) {
      /* 无痕模式或空间受限时忽略持久化错误 */
    }
  }

  loadStorage();

  // ---- UI Injection ----
  let styleEl = null;
  let openBtn = null;
  let trackerEl = null;
  let trackerKindEl = null;
  let trackerTitleEl = null;
  let trackerCollapseBtn = null;
  let trackerStepEl = null;
  let trackerClueEl = null;
  let trackerDotsEl = null;
  let trackerWayBtn = null;
  let trackerPanelBtn = null;
  let dialogEl = null;
  let closeBtn = null;
  let toastEl = null;
  let tabMainBtn = null;
  let tabSideBtn = null;
  let tabSealBtn = null;
  let panelMainEl = null;
  let panelSideEl = null;
  let panelSealEl = null;
  let resetBtn = null;

  let createdStyle = false;
  let createdOpenBtn = false;
  let createdTracker = false;
  let createdDialog = false;
  let createdToast = false;
  const cleanups = [];

  function showToast(text) {
    if (!toastEl || !text || disposed) return;
    toastEl.textContent = text;
    toastEl.classList?.add?.('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl?.classList?.remove?.('show');
      toastTimer = null;
    }, 3800);
    if (toastTimer && typeof toastTimer.unref === 'function') toastTimer.unref();
  }

  function currentPhenologyId() {
    const ph = typeof getPhenology === 'function' ? getPhenology() : getPhenology;
    return ph?.currentId || sky?.phenologyId || 'spring';
  }

  function isModalBusy() {
    return sharedIsModalBusy(doc, {
      ignore: 'quest-open',
      includeCruise: true,
      includeVeil: true,
      runtime: {
        map,
        journal,
        scrollStudio: getScrollStudio?.(),
        travelerGuide: getTravelerGuide?.()
      }
    });
  }

  function isOpen() {
    return Boolean(dialogEl?.open);
  }

  // ---- Wayfinder Resolution ----
  function resolveWayfinderTarget(spec) {
    if (!spec) return null;
    let x = spec.x;
    let z = spec.z;
    let poiId = spec.poiId || null;
    let name = spec.name || '所往之地';
    let poem = spec.poem || '落英随风，循溪寻津';

    if (spec.dynamic === 'hospitalityFeast') {
      x = anchors.hospitalityFeast.x;
      z = anchors.hospitalityFeast.z;
    } else if (spec.dynamic === 'weaving') {
      x = anchors.weaving.x;
      z = anchors.weaving.z;
    } else if (spec.dynamic === 'carpentry') {
      x = anchors.carpentry.x;
      z = anchors.carpentry.z;
    } else if (spec.dynamic === 'hearth') {
      x = anchors.hearth.x;
      z = anchors.hearth.z;
    } else if (spec.dynamic === 'waterworks') {
      x = anchors.waterworks.x;
      z = anchors.waterworks.z;
    } else if (spec.dynamic === 'oxPlowing') {
      x = anchors.oxPlowing.x;
      z = anchors.oxPlowing.z;
    } else if (spec.dynamic && spec.dynamic.startsWith('egg:')) {
      const eggId = spec.dynamic.slice(4);
      const pos = anchors.eggs[eggId];
      if (pos) {
        x = pos.x;
        z = pos.z;
      }
    } else if (spec.dynamic === 'act3Mark') {
      const stg = act3Finale?.stage || 'idle';
      if (stg === 'marking') {
        const placed = act3Finale?.placedCount ?? 0;
        const nextM = placed < 2 ? act3Finale?.getNextUnplacedMarker?.() : null;
        if (nextM) {
          poiId = null;
          x = nextM.x;
          z = nextM.z;
          name = nextM.name || '处处志之';
          poem = '沿外溪畔叠石系帛为志';
        } else if (act3Finale?.departFerryPos) {
          poiId = null;
          x = act3Finale.departFerryPos.x;
          z = act3Finale.departFerryPos.z;
          name = '下津扁舟';
          poem = '顺溪出山，往诣太守';
        }
      } else {
        x = 24;
        z = -22;
      }
    }
    return { poiId, x, z, name, poem };
  }

  function currentWayfinderForQuest(questId) {
    if (questId === MAIN_QUEST.id) {
      const idx = Math.min(state.mainStep, MAIN_QUEST.steps.length - 1);
      return resolveWayfinderTarget(MAIN_QUEST.steps[idx]?.wayfinder);
    }
    const q = QUEST_BY_ID.get(questId);
    if (!q) return null;
    const rec = state.sides[q.id];
    for (const s of q.steps) {
      if (!rec.doneSteps.has(s.id)) return resolveWayfinderTarget(s.wayfinder);
    }
    const last = q.steps[q.steps.length - 1];
    return resolveWayfinderTarget(last?.wayfinder);
  }

  function isWayfinderActiveFor(questId) {
    if (!map || state.wayfinderQuestId !== questId) return false;
    const curDest = map.getDestination?.();
    if (!curDest) return false;
    const target = currentWayfinderForQuest(questId);
    if (!target) return false;
    return curDest.id === ('quest:' + questId) || (target.poiId && curDest.id === target.poiId);
  }

  function clearWayfinder() {
    state.wayfinderQuestId = null;
    if (map) {
      const curDest = map.getDestination?.();
      if (curDest) {
        if (typeof map.setDestination === 'function') map.setDestination(null);
        else map.clearCustomDest?.();
      }
    }
    refreshAllUi();
  }

  function applyWayfinderForQuest(questId, showFeedback = true) {
    if (!map) return false;
    const rawTarget = currentWayfinderForQuest(questId);
    if (!rawTarget) return false;

    const valleySplitZ = -26;
    const valleyUnveiled = typeof map.valleyUnveiled === 'boolean'
      ? map.valleyUnveiled
      : ((player?.state?.z ?? 200) < valleySplitZ);
    const caveSealed = Boolean(act3Finale?.caveSealed || map.caveSealed);

    let target = rawTarget;
    if (caveSealed && target.z < valleySplitZ) {
      const ferry = act3Finale?.departFerryPos || { x: 13, z: 160 };
      target = {
        poiId: null,
        x: ferry.x,
        z: ferry.z,
        name: '武陵孤舟 · 系舟入梦',
        poem: '山岚封口，可于孤舟系舟一梦重返桃源'
      };
      if (showFeedback) showToast('山岚封口 · 已引风丝往武陵孤舟「系舟入梦」');
    } else if (!valleyUnveiled && target.z < valleySplitZ) {
      target = {
        poiId: 'kou',
        x: 22,
        z: 13.5,
        name: '山有小口',
        poem: '先穿山口石缝，再往桃源深处'
      };
      if (showFeedback) showToast('尚未入谷 · 风丝先引往「山有小口」');
    } else if (showFeedback) {
      showToast(`风丝寻津 · ${target.name}`);
    }

    state.wayfinderQuestId = questId;
    if (target.poiId && typeof map.setDestination === 'function') {
      const cur = map.getDestination?.();
      if (cur?.id === target.poiId) {
        // already aimed at target poi
      } else {
        map.setDestination(target.poiId);
      }
    } else if (typeof map.setCustomDest === 'function' && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      map.setCustomDest(target.x, target.z, {
        id: 'quest:' + questId,
        name: target.name,
        poem: target.poem,
        allowBeforeUnveil: target.z >= valleySplitZ
      });
    }
    refreshAllUi();
    return true;
  }

  function toggleWayfinder(questId) {
    if (isWayfinderActiveFor(questId)) {
      clearWayfinder();
      showToast('已收起风丝引路');
      return false;
    }
    return applyWayfinderForQuest(questId, true);
  }

  function syncWayfinderIfTracking(questId) {
    if (state.wayfinderQuestId === questId && map?.getDestination?.()) {
      applyWayfinderForQuest(questId, false);
    }
  }

  // ---- Quest Progression Logic ----
  function isQuestComplete(q) {
    const rec = state.sides[q.id];
    if (!rec) return false;
    if (rec.status === 'completed') return true;
    return q.steps.every(s => rec.doneSteps.has(s.id));
  }

  function completeSideQuest(q, silent = false) {
    const rec = state.sides[q.id];
    if (!rec) return false;
    const wasCompleted = rec.status === 'completed';
    rec.status = 'completed';
    for (const s of q.steps) rec.doneSteps.add(s.id);
    if (state.wayfinderQuestId === q.id) {
      clearWayfinder();
    }
    if (state.trackedId === q.id) {
      const nextActive = SIDE_QUESTS.find(sq => state.sides[sq.id]?.status === 'active' && sq.id !== q.id);
      state.trackedId = nextActive ? nextActive.id : MAIN_QUEST.id;
    }
    saveStorage();
    if (!wasCompleted && !silent) {
      playSealPluck();
      showToast(`支线结卷 · ${q.title} · 得印「${q.seal}」`);
    }
    refreshAllUi();
    return !wasCompleted;
  }

  function acceptSideQuest(questId, { silent = false, track = true } = {}) {
    const q = QUEST_BY_ID.get(questId);
    if (!q || q.id === MAIN_QUEST.id) return false;
    const rec = state.sides[q.id];
    if (!rec || rec.status === 'completed') return false;
    const wasAvailable = rec.status === 'available';
    rec.status = 'active';
    if (track) state.trackedId = q.id;
    if (isQuestComplete(q)) {
      completeSideQuest(q, silent);
      return true;
    }
    saveStorage();
    if (wasAvailable && !silent) {
      playQuestNote('accept');
      showToast(`记入简册 · ${q.title}`);
    }
    refreshAllUi();
    return wasAvailable;
  }

  function markSideStep(questId, stepId, { autoAccept = true, silent = false } = {}) {
    const q = QUEST_BY_ID.get(questId);
    if (!q || q.id === MAIN_QUEST.id) return false;
    const rec = state.sides[q.id];
    if (!rec || rec.status === 'completed') return false;
    if (rec.doneSteps.has(stepId)) return false;

    const stepIdx = q.steps.findIndex(s => s.id === stepId);
    if (stepIdx < 0) return false;
    if (q.ordered && stepIdx > 0 && !rec.doneSteps.has(q.steps[stepIdx - 1].id)) {
      return false;
    }
    if (!autoAccept && rec.status === 'available') return false;

    if (rec.status === 'available') rec.status = 'active';
    rec.doneSteps.add(stepId);
    const stepObj = q.steps[stepIdx];

    if (isQuestComplete(q)) {
      completeSideQuest(q, silent);
    } else {
      saveStorage();
      if (!silent) {
        playQuestNote('step');
        showToast(`${q.title} · 已成「${stepObj.title}」`);
      }
      syncWayfinderIfTracking(q.id);
      refreshAllUi();
    }
    return true;
  }

  function trackQuest(questId) {
    if (!QUEST_BY_ID.has(questId)) return false;
    if (questId !== MAIN_QUEST.id && state.sides[questId]?.status === 'available') {
      acceptSideQuest(questId, { silent: false, track: true });
      return true;
    }
    state.trackedId = questId;
    saveStorage();
    refreshAllUi();
    return true;
  }

  function hasClassicOrVisited(id, isPoi) {
    return isPoi ? knownVisited.has(id) : Boolean(dialogue?.hasFired?.(id) || knownClassics.has(id));
  }

  function syncMainQuest(silent = false) {
    const st = player?.state;
    const pz = st?.z;
    const act3Stage = act3Finale?.stage || 'idle';
    const inValley = Number.isFinite(pz) && pz < -30;
    const postValley = inValley || act3Stage !== 'idle' || hasClassicOrVisited('valley-open', false) || hasClassicOrVisited('village-gate', false) || hasClassicOrVisited('feast-invite', false) || hasClassicOrVisited('feast-history', false);

    mainDoneFlags[0] = (hasClassicOrVisited('peach-grove', false) || hasClassicOrVisited('taolin', true) || postValley) ? 1 : 0;
    mainDoneFlags[1] = (hasClassicOrVisited('cave-glimmer', false) || hasClassicOrVisited('kou', true) || postValley) ? 1 : 0;
    mainDoneFlags[2] = (hasClassicOrVisited('valley-open', false) || (Number.isFinite(pz) && pz < -34) || act3Stage !== 'idle' || hasClassicOrVisited('village-gate', false)) ? 1 : 0;
    mainDoneFlags[3] = (hasClassicOrVisited('village-gate', false) || hasClassicOrVisited('fields', false) || hasClassicOrVisited('house', false) || hasClassicOrVisited('cun', true) || hasClassicOrVisited('tian', true) || hasClassicOrVisited('chi', true) || act3Stage !== 'idle') ? 1 : 0;
    mainDoneFlags[4] = (hasClassicOrVisited('feast-history', false) || (act3Stage !== 'idle' && act3Stage !== 'marking')) ? 1 : 0;
    mainDoneFlags[5] = (act3Stage === 'transitioning' || act3Stage === 'returning' || act3Stage === 'lost' || act3Stage === 'epilogue' || act3Stage === 'linger' || hasClassicOrVisited('act3-prefect-return', false)) ? 1 : 0;
    mainDoneFlags[6] = (act3Stage === 'lost' || act3Stage === 'epilogue' || act3Stage === 'linger' || hasClassicOrVisited('act3-lost-way', false)) ? 1 : 0;
    mainDoneFlags[7] = (act3Stage === 'epilogue' || act3Stage === 'linger' || hasClassicOrVisited('act3-no-seeker', false)) ? 1 : 0;

    let nextStep = state.mainStep;
    for (let i = 0; i < mainDoneFlags.length; i++) {
      if (i === nextStep && mainDoneFlags[i]) nextStep++;
    }
    // Also advance if later milestones already occurred (e.g. teleported or loaded mid-way)
    for (let i = mainDoneFlags.length - 1; i >= 0; i--) {
      if (mainDoneFlags[i] && i + 1 > nextStep) {
        nextStep = i + 1;
        break;
      }
    }

    const nextCompleted = nextStep >= MAIN_QUEST.steps.length;
    if (nextStep !== state.mainStep || nextCompleted !== state.mainCompleted) {
      const prevStep = state.mainStep;
      state.mainStep = nextStep;
      state.mainCompleted = nextCompleted;
      saveStorage();
      if (!silent && nextStep > prevStep) {
        if (nextCompleted) {
          clearWayfinder();
          playSealPluck();
          showToast(`主线终章 · 桃源本传既成 · 得印「${MAIN_QUEST.seal}」`);
        } else {
          const curStepObj = MAIN_QUEST.steps[nextStep];
          syncWayfinderIfTracking(MAIN_QUEST.id);
          playQuestNote('step');
          showToast(`本传新章 · ${curStepObj.title}`);
        }
      }
      refreshAllUi();
    }
  }

  // ---- World Event Hooks ----
  function notifyTalk(target) {
    if (disposed || !target) return;
    const role = target.ref?.role || target.role || '';
    if (!role) return;

    if (role === 'feast_host' || role === 'feast_elder' || role === 'feast_guest') {
      if (state.mainStep <= 4) {
        state.mainStep = Math.max(state.mainStep, 5);
        saveStorage();
        syncWayfinderIfTracking(MAIN_QUEST.id);
        playQuestNote('step');
        showToast('本传新章 · 辞去志之');
        refreshAllUi();
      }
    }
    if (role === 'mountain_tea_host' || role === 'tea_picker') {
      markSideStep('side-tea-message', 'visit-pine-tea');
    } else if (role === 'outskirt_greeter') {
      if (state.sides['side-tea-message']?.doneSteps.has('visit-pine-tea')) {
        markSideStep('side-tea-message', 'return-tea-greeter');
      }
      if (currentPhenologyId() === 'winter') {
        markSideStep('side-four-seasons-tea', 'season-winter-tea');
      }
    } else if (role === 'outskirt_gatherer') {
      markSideStep('side-silk-loom', 'visit-mulberry-gatherer');
    } else if (role === 'weaver') {
      if (state.sides['side-silk-loom']?.doneSteps.has('visit-mulberry-gatherer')) {
        markSideStep('side-silk-loom', 'return-weaver');
      }
    } else if (role === 'carpenter' || role === 'bamboo_artisan') {
      if (state.sides['side-waterwheel-craft']?.doneSteps.has('inspect-waterworks')) {
        markSideStep('side-waterwheel-craft', 'return-carpenter');
      }
    } else if (role === 'altar_keeper') {
      markSideStep('side-qin-records', 'lore-ancient-altar');
    } else if (role === 'lanke_elder') {
      markSideStep('side-lanke-brew', 'lore-lanke-crag');
    } else if (role === 'plowman' || role === 'hut_farmer') {
      if (currentPhenologyId() === 'spring') {
        markSideStep('side-spring-plow', 'season-watch-plow');
      }
    } else if (role === 'fou_singer' || role === 'night_feaster') {
      const rain = Number(sky?.rainIntensity ?? 0) || 0;
      const snow = Number(sky?.snowIntensity ?? 0) || 0;
      if ((sky?.timeId || 'day') === 'night' && rain < 0.2 && snow < 0.2) {
        markSideStep('side-night-fou', 'season-night-hearth');
      }
    } else if (role === 'liubo_player' || role === 'liubo_watcher') {
      if (currentPhenologyId() === 'summer') {
        markSideStep('side-four-seasons-tea', 'season-summer-liubo');
      }
    }
  }

  function notifyInteraction(target) {
    if (disposed || !target) return;
    const id = target.id || target.siteId || target.ref?.id || '';
    if (!id) return;
    if (id === 'qin-bamboo-slips') markSideStep('side-qin-records', 'lore-bamboo-slips');
    else if (id === 'borderland-qin-stele') markSideStep('side-qin-records', 'lore-qin-stele');
    else if (id === 'ancient-qin-altar') markSideStep('side-qin-records', 'lore-ancient-altar');
    else if (id === 'cloud-guqin-stone') markSideStep('side-guqin-deer', 'lore-play-guqin');
    else if (id === 'moon-white-stag' || id === 'deer-brushwood-hermitage') markSideStep('side-guqin-deer', 'lore-white-stag');
    else if (id === 'floating-wine-cup') markSideStep('side-lanke-brew', 'lore-floating-cup');
    else if (id === 'camphor-hollow-brew') markSideStep('side-lanke-brew', 'lore-hollow-brew');
    else if (id === 'lanke-chess-crag') markSideStep('side-lanke-brew', 'lore-lanke-crag');
    else if (id === 'mountain-tea-shelter' || id === 'mountain-tea-seat') markSideStep('side-tea-message', 'visit-pine-tea');
    else if (id === 'entrance-tea-shelter' && currentPhenologyId() === 'winter') markSideStep('side-four-seasons-tea', 'season-winter-tea');
    else if (id === 'cloud-pavilion' || id === 'cloud-pavilion-seat') {
      if (currentPhenologyId() === 'autumn') markSideStep('side-four-seasons-tea', 'season-autumn-cloud');
    }
  }

  function notifyJournalEvent(kind, value) {
    if (disposed) return;
    if (kind === 'places' && typeof value === 'string') knownVisited.add(value);
    if (kind === 'classics' && typeof value === 'string') knownClassics.add(value);
    if (kind === 'guide' && (value === 'waterwheel' || value === 'water-mortar')) {
      markSideStep('side-waterwheel-craft', 'inspect-waterworks');
    }
    if (kind === 'places' || kind === 'classics') {
      syncMainQuest(false);
    }
  }

  // ---- Villager Dialogue Bridge ----
  function getPromptHint(target) {
    const role = target?.ref?.role || target?.role || '';
    if (!role) return null;

    // 1. 已结卷待回报的托付优先提示
    for (const q of SIDE_QUESTS) {
      if (q.giverRole !== role) continue;
      const rec = state.sides[q.id];
      if (rec?.status === 'completed' && !rec.talkedComplete && q.dialogue?.turnIn) {
        return { kind: 'turnIn', tag: '待捎回音', questId: q.id, title: q.title };
      }
    }

    // 2. 主线或进行中支线的目标人物
    if (!state.mainCompleted && state.mainStep === 4 && (role === 'feast_host' || role === 'feast_elder' || role === 'feast_guest')) {
      return { kind: 'step', tag: '本传所访', questId: MAIN_QUEST.id, title: MAIN_QUEST.title };
    }
    const phId = currentPhenologyId();
    for (const q of SIDE_QUESTS) {
      const rec = state.sides[q.id];
      if (!rec || rec.status !== 'active') continue;
      const done = sid => rec.doneSteps.has(sid);
      if (q.id === 'side-tea-message') {
        if (!done('visit-pine-tea') && (role === 'mountain_tea_host' || role === 'tea_picker')) {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
        if (done('visit-pine-tea') && !done('return-tea-greeter') && role === 'outskirt_greeter') {
          return { kind: 'turnIn', tag: '待捎回音', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-silk-loom') {
        if (!done('visit-mulberry-gatherer') && role === 'outskirt_gatherer') {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
        if (done('visit-mulberry-gatherer') && !done('return-weaver') && role === 'weaver') {
          return { kind: 'turnIn', tag: '待捎回音', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-waterwheel-craft') {
        if (done('inspect-waterworks') && !done('return-carpenter') && (role === 'carpenter' || role === 'bamboo_artisan')) {
          return { kind: 'turnIn', tag: '待捎回音', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-qin-records') {
        if (!done('lore-ancient-altar') && role === 'altar_keeper') {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-lanke-brew') {
        if (!done('lore-lanke-crag') && role === 'lanke_elder') {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-spring-plow') {
        if (!done('season-watch-plow') && phId === 'spring' && (role === 'plowman' || role === 'hut_farmer')) {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-night-fou') {
        if (!done('season-night-hearth') && sky?.timeId === 'night' && (role === 'fou_singer' || role === 'night_feaster')) {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
      } else if (q.id === 'side-four-seasons-tea') {
        if (!done('season-winter-tea') && phId === 'winter' && role === 'outskirt_greeter') {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
        if (!done('season-summer-liubo') && phId === 'summer' && role === 'liubo_player') {
          return { kind: 'step', tag: '简册所访', questId: q.id, title: q.title };
        }
      }
    }

    // 3. 可接取的新支线托付
    for (const q of SIDE_QUESTS) {
      if (q.giverRole !== role) continue;
      const rec = state.sides[q.id];
      if (rec?.status === 'available' && q.dialogue?.offer) {
        return { kind: 'offer', tag: '似有托付', questId: q.id, title: q.title };
      }
    }
    return null;
  }

  function getMapMarkers() {
    const out = [];
    if (!state.mainCompleted) {
      const step = MAIN_QUEST.steps[Math.min(state.mainStep, MAIN_QUEST.steps.length - 1)];
      const t = resolveWayfinderTarget(step?.wayfinder);
      if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
        out.push({
          id: 'quest:' + MAIN_QUEST.id,
          questId: MAIN_QUEST.id,
          kind: 'main',
          glyph: '传',
          title: '本传 · ' + step.title,
          subtitle: step.clue,
          x: t.x,
          z: t.z,
          poiId: t.poiId || null,
          tracked: state.trackedId === MAIN_QUEST.id
        });
      }
    }
    for (const q of SIDE_QUESTS) {
      const rec = state.sides[q.id];
      if (!rec) continue;
      if (rec.status === 'active') {
        let nextStep = null;
        for (const s of q.steps) {
          if (!rec.doneSteps.has(s.id)) { nextStep = s; break; }
        }
        const refStep = nextStep || q.steps[q.steps.length - 1];
        const t = resolveWayfinderTarget(refStep?.wayfinder);
        if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
          out.push({
            id: 'quest:' + q.id,
            questId: q.id,
            kind: 'active',
            glyph: '笺',
            title: '支线 · ' + q.title,
            subtitle: (refStep?.title ? refStep.title + ' · ' : '') + (refStep?.clue || q.summary),
            x: t.x,
            z: t.z,
            poiId: t.poiId || null,
            tracked: state.trackedId === q.id
          });
        }
      } else if (rec.status === 'completed' && !rec.talkedComplete && q.dialogue?.turnIn) {
        const lastStep = q.steps[q.steps.length - 1];
        const t = resolveWayfinderTarget(lastStep?.wayfinder);
        if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
          out.push({
            id: 'quest:' + q.id,
            questId: q.id,
            kind: 'turnIn',
            glyph: '信',
            title: '待复 · ' + q.title,
            subtitle: '回访' + q.giverName + '捎去回音',
            x: t.x,
            z: t.z,
            poiId: t.poiId || null,
            tracked: false
          });
        }
      } else if (rec.status === 'available') {
        const firstStep = q.steps[0];
        const t = resolveWayfinderTarget(firstStep?.wayfinder);
        if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
          out.push({
            id: 'quest:' + q.id,
            questId: q.id,
            kind: 'available',
            glyph: '访',
            title: '传闻 · ' + q.title,
            subtitle: q.rumorHint || q.summary,
            x: t.x,
            z: t.z,
            poiId: t.poiId || null,
            tracked: false
          });
        }
      }
    }
    return out;
  }

  function getDialogueOffer(target) {
    const role = target?.ref?.role || target?.role || '';
    if (!role) return null;
    for (const q of SIDE_QUESTS) {
      if (q.giverRole !== role) continue;
      const rec = state.sides[q.id];
      if (!rec) continue;
      const allStepsDone = isQuestComplete(q);
      if (rec.status === 'available' && q.dialogue?.offer) {
        return {
          questId: q.id,
          questTitle: q.title,
          kind: 'offer',
          replyLabel: q.dialogue.offer.replyLabel,
          npcReply: q.dialogue.offer.npcReply,
          closingReply: q.dialogue.offer.closingReply,
          followUpLabel: '应下此事，且去行看'
        };
      }
      if (rec.status === 'completed' && !rec.talkedComplete && q.dialogue?.turnIn) {
        return {
          questId: q.id,
          questTitle: q.title,
          kind: 'turnIn',
          replyLabel: q.dialogue.turnIn.replyLabel,
          npcReply: q.dialogue.turnIn.npcReply,
          closingReply: q.dialogue.turnIn.closingReply,
          followUpLabel: '叙罢辞行'
        };
      }
      if (rec.status === 'active' && !allStepsDone && q.dialogue?.inProgress) {
        return {
          questId: q.id,
          questTitle: q.title,
          kind: 'inProgress',
          replyLabel: q.dialogue.inProgress.replyLabel,
          npcReply: q.dialogue.inProgress.npcReply,
          closingReply: q.dialogue.inProgress.closingReply,
          followUpLabel: '记下便是，就此告辞'
        };
      }
    }
    return null;
  }

  function onDialogueSelect(offer) {
    if (!offer || !offer.questId) return;
    const q = QUEST_BY_ID.get(offer.questId);
    if (!q) return;
    if (offer.kind === 'offer') {
      acceptSideQuest(q.id, { silent: false, track: true });
    } else if (offer.kind === 'turnIn') {
      const rec = state.sides[q.id];
      if (rec) {
        rec.talkedComplete = true;
        saveStorage();
        refreshAllUi();
      }
    }
  }

  // ---- Periodic Low-Rate Spatial/Seasonal Evaluation (Zero Alloc) ----
  function pollWorldConditions() {
    syncMainQuest(false);

    const st = player?.state;
    const px = st?.x;
    const pz = st?.z;
    const hasPos = Number.isFinite(px) && Number.isFinite(pz);
    const phId = currentPhenologyId();
    const rain = Number(sky?.rainIntensity ?? 0) || 0;
    const snow = Number(sky?.snowIntensity ?? 0) || 0;
    const timeId = sky?.timeId || 'day';
    const seatId = situationalRest?.currentSeatId || null;

    if (hasPos) {
      // 1. East canal waterwheel inspection (proximity or quiet spot)
      const ww = anchors.waterworks;
      if (Math.hypot(px - ww.x, pz - ww.z) <= 11 || (quiet?.active && quiet?.spot?.name === '筒车流水')) {
        markSideStep('side-waterwheel-craft', 'inspect-waterworks');
      }
      // 2. Guqin pentatonic plucking
      if ((poeticInteractions?.pentatonicCount || 0) > 0) {
        markSideStep('side-guqin-deer', 'lore-play-guqin');
      }
      // 3. Spring plowing appreciation
      const ox = anchors.oxPlowing;
      if (phId === 'spring' && rain < 0.45 && (Math.hypot(px - ox.x, pz - ox.z) <= 12 || (quiet?.active && quiet?.spot?.name === '春畴牛耕'))) {
        markSideStep('side-spring-plow', 'season-watch-plow');
      }
      // 4. Clear night fou song at threshing hearth
      const hth = anchors.hearth;
      if (timeId === 'night' && rain < 0.2 && snow < 0.2) {
        if (Math.hypot(px - hth.x, pz - hth.z) <= 10 || (quiet?.active && quiet?.spot?.name === '夜阑缶歌')) {
          markSideStep('side-night-fou', 'season-night-hearth');
        }
      }
      // 5. Summer Liubo pavilion
      const pav = anchors.pavilion;
      if (phId === 'summer' && (Math.hypot(px - pav.x, pz - pav.z) <= 12 || (seatId && seatId.includes('pavilion')))) {
        markSideStep('side-four-seasons-tea', 'season-summer-liubo');
      }
      // 6. Autumn Cloud Pavilion
      if (phId === 'autumn' && (Math.hypot(px - 124.5, pz + 170) <= 14 || seatId === 'cloud-pavilion-seat')) {
        markSideStep('side-four-seasons-tea', 'season-autumn-cloud');
      }
    }
  }

  // ---- Rendering Tracker & Dialog ----
  function activeQuestDescriptor() {
    if (state.trackedId === MAIN_QUEST.id || !QUEST_BY_ID.has(state.trackedId)) {
      if (state.mainCompleted) {
        return {
          id: MAIN_QUEST.id,
          kindLabel: '主线',
          isSide: false,
          title: MAIN_QUEST.title,
          stepTitle: '三幕既毕 · 桃源闲居',
          clue: '三幕本传皆已圆融，可于四时晨昏漫游桃源，或翻阅简册支线。',
          total: MAIN_QUEST.steps.length,
          doneCount: MAIN_QUEST.steps.length,
          curIdx: -1
        };
      }
      const idx = Math.min(state.mainStep, MAIN_QUEST.steps.length - 1);
      const step = MAIN_QUEST.steps[idx];
      return {
        id: MAIN_QUEST.id,
        kindLabel: '主线',
        isSide: false,
        title: MAIN_QUEST.title,
        stepTitle: `${step.act} · ${step.title}`,
        clue: step.clue,
        total: MAIN_QUEST.steps.length,
        doneCount: state.mainStep,
        curIdx: idx
      };
    }

    const q = QUEST_BY_ID.get(state.trackedId);
    const rec = state.sides[q.id];
    let curStep = null;
    let curIdx = -1;
    for (let i = 0; i < q.steps.length; i++) {
      if (!rec.doneSteps.has(q.steps[i].id)) {
        curStep = q.steps[i];
        curIdx = i;
        break;
      }
    }
    return {
      id: q.id,
      kindLabel: '支线',
      isSide: true,
      title: q.title,
      stepTitle: curStep ? curStep.title : `已结卷 · ${q.seal}`,
      clue: curStep ? curStep.clue : q.colophon,
      total: q.steps.length,
      doneCount: rec.doneSteps.size,
      curIdx
    };
  }

  function renderTracker() {
    if (!trackerEl) return;
    const desc = activeQuestDescriptor();
    const wayOn = isWayfinderActiveFor(desc.id);
    const sig = `${desc.id}|${desc.doneCount}|${desc.curIdx}|${trackerCollapsed}|${wayOn}`;
    if (sig === lastTrackerSig) return;
    lastTrackerSig = sig;

    trackerEl.classList?.toggle?.('is-collapsed', trackerCollapsed);
    if (trackerCollapseBtn) trackerCollapseBtn.textContent = trackerCollapsed ? '展' : '收';
    if (trackerKindEl) {
      trackerKindEl.textContent = desc.kindLabel;
      trackerKindEl.classList?.toggle?.('is-side', desc.isSide);
    }
    if (trackerTitleEl) trackerTitleEl.textContent = desc.title;
    if (trackerStepEl) trackerStepEl.textContent = desc.stepTitle;
    if (trackerClueEl) trackerClueEl.textContent = desc.clue;
    if (trackerDotsEl) {
      trackerDotsEl.replaceChildren();
      for (let i = 0; i < desc.total; i++) {
        const dot = doc.createElement('span');
        dot.className = 'qtrack__dot';
        if (i < desc.doneCount) dot.classList.add('is-done');
        else if (i === desc.curIdx) dot.classList.add('is-cur');
        trackerDotsEl.appendChild(dot);
      }
    }
    if (trackerWayBtn) {
      trackerWayBtn.textContent = wayOn ? '收风丝' : '风丝引路';
      trackerWayBtn.classList?.toggle?.('is-active', wayOn);
      trackerWayBtn.hidden = desc.curIdx < 0;
    }
  }

  function renderMainPanel() {
    if (!panelMainEl || !doc?.createElement) return;
    panelMainEl.replaceChildren();

    const banner = doc.createElement('div');
    banner.className = 'quest__banner';
    const info = doc.createElement('div');
    const h3 = doc.createElement('h3');
    h3.textContent = `${MAIN_QUEST.title} · ${MAIN_QUEST.subtitle}`;
    const p = doc.createElement('p');
    p.textContent = MAIN_QUEST.summary;
    info.append(h3, p);

    const btns = doc.createElement('div');
    btns.className = 'quest__btn-row';
    const isTracked = state.trackedId === MAIN_QUEST.id;
    const trackBtn = doc.createElement('button');
    trackBtn.type = 'button';
    trackBtn.className = 'quest__btn' + (isTracked ? ' is-primary' : '');
    trackBtn.textContent = isTracked ? '当前指引中' : '设为当前指引';
    trackBtn.addEventListener('click', () => trackQuest(MAIN_QUEST.id));
    btns.appendChild(trackBtn);

    if (!state.mainCompleted) {
      const wayBtn = doc.createElement('button');
      wayBtn.type = 'button';
      const wayOn = isWayfinderActiveFor(MAIN_QUEST.id);
      wayBtn.className = 'quest__btn' + (wayOn ? ' is-way' : '');
      wayBtn.textContent = wayOn ? '收起风丝引路' : '风丝引路';
      wayBtn.addEventListener('click', () => toggleWayfinder(MAIN_QUEST.id));
      btns.appendChild(wayBtn);
    }
    banner.append(info, btns);
    panelMainEl.appendChild(banner);

    const ol = doc.createElement('ol');
    ol.className = 'quest__timeline';
    MAIN_QUEST.steps.forEach((step, idx) => {
      const done = idx < state.mainStep || state.mainCompleted;
      const cur = !state.mainCompleted && idx === state.mainStep;
      const li = doc.createElement('li');
      li.className = 'quest__step-item' + (done ? ' is-done' : cur ? ' is-cur' : '');

      const head = doc.createElement('div');
      head.className = 'quest__step-head';
      const left = doc.createElement('div');
      const actEl = doc.createElement('div');
      actEl.className = 'quest__step-act';
      actEl.textContent = step.act;
      const titleEl = doc.createElement('div');
      titleEl.className = 'quest__step-title';
      titleEl.textContent = `${idx + 1}. ${step.title}`;
      left.append(actEl, titleEl);

      const badge = doc.createElement('span');
      badge.className = 'quest__badge' + (done ? ' is-done' : cur ? ' is-cur' : '');
      badge.textContent = done ? '已历' : cur ? '正行' : '待寻';
      head.append(left, badge);

      const classicEl = doc.createElement('p');
      classicEl.className = 'quest__classic';
      classicEl.textContent = `「${step.classic}」`;

      const clueEl = doc.createElement('p');
      clueEl.className = 'quest__clue';
      clueEl.textContent = step.clue;

      li.append(head, classicEl, clueEl);
      ol.appendChild(li);
    });
    panelMainEl.appendChild(ol);
  }

  function renderSidePanel() {
    if (!panelSideEl || !doc?.createElement) return;
    panelSideEl.replaceChildren();

    for (const cat of CATEGORY_ORDER) {
      const list = SIDE_QUESTS.filter(q => q.category === cat.id);
      if (!list.length) continue;
      const heading = doc.createElement('h3');
      heading.className = 'quest__group-title';
      heading.textContent = cat.label;
      panelSideEl.appendChild(heading);

      const grid = doc.createElement('div');
      grid.className = 'quest__cards';
      for (const q of list) {
        const rec = state.sides[q.id];
        const completed = rec.status === 'completed';
        const active = rec.status === 'active';
        const isTracked = state.trackedId === q.id;
        const wayOn = isWayfinderActiveFor(q.id);

        const card = doc.createElement('article');
        card.className = 'quest__card' + (completed ? ' is-completed' : '');

        const top = doc.createElement('div');
        const cHead = doc.createElement('div');
        cHead.className = 'quest__card-head';
        const titleWrap = doc.createElement('div');
        const tEl = doc.createElement('h4');
        tEl.className = 'quest__card-title';
        tEl.textContent = q.title;
        const gEl = doc.createElement('div');
        gEl.className = 'quest__card-giver';
        gEl.textContent = `缘起 · ${q.giverName}`;
        titleWrap.append(tEl, gEl);

        const badge = doc.createElement('span');
        badge.className = completed ? 'quest__seal-inline' : ('quest__badge' + (active ? ' is-cur' : ''));
        badge.textContent = completed ? q.seal : active ? '进行中' : '待闻见';
        cHead.append(titleWrap, badge);

        const descEl = doc.createElement('p');
        descEl.className = 'quest__card-desc';
        descEl.textContent = q.summary;

        const ul = doc.createElement('ul');
        ul.className = 'quest__substeps';
        for (const s of q.steps) {
          const done = rec.doneSteps.has(s.id);
          const li = doc.createElement('li');
          if (done) li.className = 'is-done';
          const dot = doc.createElement('span');
          dot.className = 'quest__subdot';
          const txt = doc.createElement('span');
          txt.textContent = `${s.title}：${s.clue}`;
          li.append(dot, txt);
          ul.appendChild(li);
        }

        top.append(cHead, descEl, ul);

        const actions = doc.createElement('div');
        actions.className = 'quest__btn-row';
        if (!completed) {
          if (rec.status === 'available') {
            const acceptBtn = doc.createElement('button');
            acceptBtn.type = 'button';
            acceptBtn.className = 'quest__btn is-primary';
            acceptBtn.textContent = '记入简册';
            acceptBtn.addEventListener('click', () => acceptSideQuest(q.id, { silent: false, track: true }));
            actions.appendChild(acceptBtn);
          } else {
            const trBtn = doc.createElement('button');
            trBtn.type = 'button';
            trBtn.className = 'quest__btn' + (isTracked ? ' is-primary' : '');
            trBtn.textContent = isTracked ? '当前指引中' : '追踪此卷';
            trBtn.addEventListener('click', () => trackQuest(q.id));
            actions.appendChild(trBtn);
          }

          const wayBtn = doc.createElement('button');
          wayBtn.type = 'button';
          wayBtn.className = 'quest__btn' + (wayOn ? ' is-way' : '');
          wayBtn.textContent = wayOn ? '收风丝' : '风丝引路';
          wayBtn.addEventListener('click', () => {
            if (rec.status === 'available') acceptSideQuest(q.id, { silent: true, track: true });
            else trackQuest(q.id);
            toggleWayfinder(q.id);
          });
          actions.appendChild(wayBtn);
        } else {
          const noteBtn = doc.createElement('span');
          noteBtn.className = 'quest__card-giver';
          noteBtn.textContent = q.colophon;
          actions.appendChild(noteBtn);
        }

        card.append(top, actions);
        grid.appendChild(card);
      }
      panelSideEl.appendChild(grid);
    }
  }

  function getEarnedSeals() {
    const earned = [];
    if (state.mainCompleted) {
      earned.push({
        questId: MAIN_QUEST.id,
        seal: MAIN_QUEST.seal,
        title: `${MAIN_QUEST.title} · 终章印`,
        categoryLabel: '主线终章',
        colophon: MAIN_QUEST.colophon
      });
    }
    for (const q of SIDE_QUESTS) {
      if (state.sides[q.id]?.status === 'completed') {
        earned.push({
          questId: q.id,
          seal: q.seal,
          title: `${q.title} · ${q.categoryLabel}`,
          categoryLabel: q.categoryLabel,
          colophon: q.colophon
        });
      }
    }
    return earned;
  }

  function renderSealPanel() {
    if (!panelSealEl || !doc?.createElement) return;
    panelSealEl.replaceChildren();

    const earned = getEarnedSeals();

    if (!earned.length) {
      const empty = doc.createElement('div');
      empty.className = 'quest__empty';
      empty.textContent = '尚无结卷朱印。漫步山水间，与村人叙话或寻访古琴、残碑、四时雅集，印记自成于卷。';
      panelSealEl.appendChild(empty);
      return;
    }

    const grid = doc.createElement('div');
    grid.className = 'quest__seals-grid';
    const hasStudio = Boolean(getScrollStudio?.());
    for (const item of earned) {
      const card = doc.createElement('div');
      card.className = 'quest__seal-card';
      const stamp = doc.createElement('div');
      stamp.className = 'quest__seal-stamp';
      stamp.textContent = item.seal;
      const body = doc.createElement('div');
      const title = doc.createElement('div');
      title.className = 'quest__seal-title';
      title.textContent = item.title;
      const text = doc.createElement('p');
      text.className = 'quest__seal-text';
      text.textContent = item.colophon;
      body.append(title, text);
      if (hasStudio) {
        const actRow = doc.createElement('div');
        actRow.className = 'quest__seal-actions';
        const useBtn = doc.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'quest__btn';
        useBtn.textContent = '以此印留影';
        useBtn.addEventListener('click', () => {
          close({ restoreFocus: false });
          const ss = getScrollStudio?.();
          if (ss) {
            ss.setCustomInscription?.({ seal: item.seal });
            ss.openCapture?.(false, {
              statusHint: `已携简册朱印「${item.seal}」入画，可直接展卷或换题跋`
            });
          }
        });
        actRow.appendChild(useBtn);
        body.appendChild(actRow);
      }
      card.append(stamp, body);
      grid.appendChild(card);
    }
    panelSealEl.appendChild(grid);
  }

  function selectTab(tabId) {
    activeTab = tabId;
    tabMainBtn?.setAttribute?.('aria-pressed', String(tabId === 'main'));
    tabSideBtn?.setAttribute?.('aria-pressed', String(tabId === 'side'));
    tabSealBtn?.setAttribute?.('aria-pressed', String(tabId === 'seal'));
    if (panelMainEl) panelMainEl.hidden = tabId !== 'main';
    if (panelSideEl) panelSideEl.hidden = tabId !== 'side';
    if (panelSealEl) panelSealEl.hidden = tabId !== 'seal';
  }

  function refreshAllUi() {
    renderTracker();
    if (isOpen()) {
      renderMainPanel();
      renderSidePanel();
      renderSealPanel();
    }
  }

  // ---- Modal Open / Close ----
  function open(fromKeyboard = false) {
    if (disposed || isOpen() || isModalBusy()) return false;
    suppressCloseRestore = false;
    returnFocus = doc?.activeElement || null;
    const returnToRoaming = fromKeyboard === true && (returnFocus === doc?.body || returnFocus === canvas);
    wasLocked = Boolean(canvas && doc?.pointerLockElement === canvas);
    player?.clearInput?.();
    if (doc?.pointerLockElement) {
      try { doc.exitPointerLock?.(); } catch {}
    }
    syncMainQuest(true);
    doc?.body?.classList?.add?.('quest-open');
    if (dialogEl) {
      dialogEl.dataset.returnToRoaming = returnToRoaming ? '1' : '0';
      if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
      else dialogEl.open = true;
      refreshAllUi();
      closeBtn?.focus?.();
    } else {
      refreshAllUi();
    }
    return true;
  }

  function onDialogClosed() {
    doc?.body?.classList?.remove?.('quest-open');
    player?.clearInput?.();
    const skipRestore = suppressCloseRestore || Boolean(doc?.body?.classList?.contains?.('scroll-studio-open'));
    suppressCloseRestore = false;
    if (skipRestore) {
      wasLocked = false;
      return;
    }
    const relock = wasLocked;
    const toRoaming = dialogEl?.dataset?.returnToRoaming === '1';
    wasLocked = false;
    if (toRoaming && canvas?.focus) {
      try { canvas.focus({ preventScroll: true }); } catch {}
    } else if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus !== doc?.body) {
      try { returnFocus.focus(); } catch {}
    } else {
      try { openBtn?.focus?.(); } catch {}
    }
    if (relock && canvas) {
      try { canvas.focus?.({ preventScroll: true }); } catch {}
      try { Promise.resolve(canvas.requestPointerLock?.()).catch?.(() => {}); } catch {}
    }
  }

  function close(opts = {}) {
    const { restoreFocus = true } = opts || {};
    if (!dialogEl || !dialogEl.open) return false;
    player?.clearInput?.();
    doc?.body?.classList?.remove?.('quest-open');
    if (!restoreFocus) {
      suppressCloseRestore = true;
      wasLocked = false;
    }
    if (typeof dialogEl.close === 'function') dialogEl.close();
    else {
      dialogEl.open = false;
      onDialogClosed();
    }
    return true;
  }

  function toggle(fromKeyboard = false) {
    return isOpen() ? close() : open(fromKeyboard);
  }

  function reset({ silent = false } = {}) {
    state.mainStep = 0;
    state.mainCompleted = false;
    state.trackedId = MAIN_QUEST.id;
    for (const q of SIDE_QUESTS) {
      state.sides[q.id] = makeEmptySideRecord();
    }
    syncJournalCaches();
    clearWayfinder();
    saveStorage();
    syncMainQuest(true);
    refreshAllUi();
    if (!silent) showToast('桃源简册已重修');
  }

  // ---- Mount DOM ----
  if (doc?.createElement) {
    styleEl = doc.getElementById?.(STYLE_ID) || null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = QUEST_CSS;
      (doc.head || doc.body || doc.documentElement)?.appendChild?.(styleEl);
      createdStyle = true;
    }

    openBtn = doc.getElementById?.('quest-open') || null;
    if (!openBtn && doc.body) {
      openBtn = doc.createElement('button');
      openBtn.id = 'quest-open';
      openBtn.type = 'button';
      openBtn.setAttribute?.('aria-keyshortcuts', 'Q');
      openBtn.textContent = '简册 ';
      const kSpan = doc.createElement('span');
      kSpan.textContent = 'Q';
      openBtn.appendChild(kSpan);
      const mountHost = doc.getElementById?.('hud-top-dock') || doc.body;
      mountHost.appendChild(openBtn);
      createdOpenBtn = true;
    }

    trackerEl = doc.getElementById?.('quest-tracker') || null;
    if (!trackerEl && doc.body) {
      trackerEl = doc.createElement('aside');
      trackerEl.id = 'quest-tracker';
      trackerEl.setAttribute?.('aria-label', '当前简册指引');

      const head = doc.createElement('div');
      head.className = 'qtrack__head';
      const titleWrap = doc.createElement('div');
      titleWrap.className = 'qtrack__title-wrap';
      trackerKindEl = doc.createElement('span');
      trackerKindEl.className = 'qtrack__kind';
      trackerTitleEl = doc.createElement('span');
      trackerTitleEl.className = 'qtrack__title';
      titleWrap.append(trackerKindEl, trackerTitleEl);

      trackerCollapseBtn = doc.createElement('button');
      trackerCollapseBtn.type = 'button';
      trackerCollapseBtn.className = 'qtrack__collapse';
      trackerCollapseBtn.setAttribute?.('aria-label', '收起或展开当前指引');
      head.append(titleWrap, trackerCollapseBtn);

      const body = doc.createElement('div');
      body.className = 'qtrack__body';
      trackerStepEl = doc.createElement('div');
      trackerStepEl.className = 'qtrack__step';
      trackerClueEl = doc.createElement('div');
      trackerClueEl.className = 'qtrack__clue';

      const foot = doc.createElement('div');
      foot.className = 'qtrack__foot';
      trackerDotsEl = doc.createElement('div');
      trackerDotsEl.className = 'qtrack__dots';
      const actions = doc.createElement('div');
      actions.className = 'qtrack__actions';
      trackerWayBtn = doc.createElement('button');
      trackerWayBtn.type = 'button';
      trackerWayBtn.className = 'qtrack__btn';
      trackerWayBtn.textContent = '风丝引路';
      trackerPanelBtn = doc.createElement('button');
      trackerPanelBtn.type = 'button';
      trackerPanelBtn.className = 'qtrack__btn';
      trackerPanelBtn.textContent = '简册';
      actions.append(trackerWayBtn, trackerPanelBtn);
      foot.append(trackerDotsEl, actions);

      body.append(trackerStepEl, trackerClueEl, foot);
      trackerEl.append(head, body);
      doc.body.appendChild(trackerEl);
      createdTracker = true;
    }

    toastEl = doc.getElementById?.('quest-toast') || null;
    if (!toastEl && doc.body) {
      toastEl = doc.createElement('div');
      toastEl.id = 'quest-toast';
      toastEl.setAttribute?.('role', 'status');
      toastEl.setAttribute?.('aria-live', 'polite');
      doc.body.appendChild(toastEl);
      createdToast = true;
    }

    dialogEl = doc.getElementById?.('quest-dialog') || null;
    if (!dialogEl && doc.body) {
      dialogEl = doc.createElement('dialog');
      dialogEl.id = 'quest-dialog';
      dialogEl.setAttribute?.('aria-labelledby', 'quest-dialog-title');

      const header = doc.createElement('header');
      header.className = 'quest__head';
      const hLeft = doc.createElement('div');
      const eye = doc.createElement('p');
      eye.className = 'quest__eyebrow';
      eye.textContent = '桃源 · 行记与托付';
      const h2 = doc.createElement('h2');
      h2.id = 'quest-dialog-title';
      h2.textContent = '桃源简册';
      hLeft.append(eye, h2);

      closeBtn = doc.createElement('button');
      closeBtn.id = 'quest-close';
      closeBtn.type = 'button';
      closeBtn.className = 'quest__btn';
      closeBtn.textContent = '合';
      closeBtn.setAttribute?.('aria-label', '关闭桃源简册');
      header.append(hLeft, closeBtn);

      const tabs = doc.createElement('nav');
      tabs.className = 'quest__tabs';
      tabs.setAttribute?.('aria-label', '简册分页');
      tabMainBtn = doc.createElement('button');
      tabMainBtn.type = 'button';
      tabMainBtn.className = 'quest__tab';
      tabMainBtn.textContent = '主线 · 本传';
      tabMainBtn.setAttribute?.('aria-pressed', 'true');
      tabSideBtn = doc.createElement('button');
      tabSideBtn.type = 'button';
      tabSideBtn.className = 'quest__tab';
      tabSideBtn.textContent = '支线 · 托付';
      tabSideBtn.setAttribute?.('aria-pressed', 'false');
      tabSealBtn = doc.createElement('button');
      tabSealBtn.type = 'button';
      tabSealBtn.className = 'quest__tab';
      tabSealBtn.textContent = '印记 · 题跋';
      tabSealBtn.setAttribute?.('aria-pressed', 'false');
      tabs.append(tabMainBtn, tabSideBtn, tabSealBtn);

      panelMainEl = doc.createElement('section');
      panelMainEl.className = 'quest__panel';
      panelSideEl = doc.createElement('section');
      panelSideEl.className = 'quest__panel';
      panelSideEl.hidden = true;
      panelSealEl = doc.createElement('section');
      panelSealEl.className = 'quest__panel';
      panelSealEl.hidden = true;

      const footer = doc.createElement('footer');
      footer.className = 'quest__foot';
      const footTip = doc.createElement('span');
      footTip.textContent = '不设时限，随兴行止 · Q / Esc 合卷';
      resetBtn = doc.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'quest__btn';
      resetBtn.textContent = '重修简册';
      footer.append(footTip, resetBtn);

      dialogEl.append(header, tabs, panelMainEl, panelSideEl, panelSealEl, footer);
      doc.body.appendChild(dialogEl);
      createdDialog = true;
    }

    const bind = (el, ev, fn, opts) => {
      if (!el?.addEventListener) return;
      el.addEventListener(ev, fn, opts);
      cleanups.push(() => el.removeEventListener(ev, fn, opts));
    };

    bind(openBtn, 'click', () => open(false));
    bind(closeBtn, 'click', () => close());
    bind(dialogEl, 'close', onDialogClosed);
    bind(dialogEl, 'click', (e) => { if (e.target === dialogEl) close(); });
    bind(tabMainBtn, 'click', () => selectTab('main'));
    bind(tabSideBtn, 'click', () => selectTab('side'));
    bind(tabSealBtn, 'click', () => selectTab('seal'));
    bind(trackerCollapseBtn, 'click', () => {
      trackerCollapsed = !trackerCollapsed;
      state.trackerCollapsed = trackerCollapsed;
      saveStorage();
      renderTracker();
    });
    bind(trackerWayBtn, 'click', () => {
      const desc = activeQuestDescriptor();
      toggleWayfinder(desc.id);
    });
    bind(trackerPanelBtn, 'click', () => open(false));
    bind(resetBtn, 'click', () => {
      if (win?.confirm && !win.confirm('确定重修桃源简册？主线追踪与支线托付进度将重新记起（不影响游记与画匣）。')) return;
      reset();
    });
  }

  // ---- Global Key Handler (capture phase, respecting god-flight Q descent) ----
  function onKeyDown(e) {
    if (disposed || !e) return;
    if (isOpen()) {
      if (e.code === 'KeyQ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault?.();
        close();
      } else if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault?.();
        close();
      }
      e.stopImmediatePropagation?.();
      return;
    }
    if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isEditable(e.target)) return;
    if (getGodFlight?.()?.active || player?.state?.godFlight || doc?.body?.classList?.contains?.('god-flight')) return;
    if (isModalBusy()) return;
    e.preventDefault?.();
    open(true);
  }
  if (win?.addEventListener) {
    win.addEventListener('keydown', onKeyDown, true);
    cleanups.push(() => win.removeEventListener('keydown', onKeyDown, true));
  }

  // ---- Wire Existing Runtime Bridges ----
  if (villagerDialogue?.setQuestBridge) {
    villagerDialogue.setQuestBridge({
      getDialogueOffer,
      onDialogueSelect,
      onTalk: notifyTalk,
      getPromptHint
    });
    cleanups.push(() => villagerDialogue.setQuestBridge(null));
  }

  let wrappedMysteries = null;
  let prevMysteriesInteract = null;
  if (mysteries && typeof mysteries.interact === 'function' && !mysteries._questWrapped) {
    wrappedMysteries = mysteries;
    prevMysteriesInteract = mysteries.interact.bind(mysteries);
    mysteries._questWrapped = true;
    mysteries.interact = function (target) {
      const res = prevMysteriesInteract(target);
      if (res) notifyInteraction(target, res);
      return res;
    };
  }

  if (journal) {
    const prevOnEvent = journal.onEvent;
    journal.onEvent = function (kind, value, id) {
      prevOnEvent?.(kind, value, id);
      notifyJournalEvent(kind, value, id);
    };
    const prevOnClear = journal.onClear;
    journal.onClear = function () {
      prevOnClear?.();
      reset({ silent: true });
    };
    cleanups.push(() => {
      journal.onEvent = prevOnEvent || null;
      journal.onClear = prevOnClear || null;
    });
  }

  syncMainQuest(true);
  renderTracker();

  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    simTimer += Math.min(dt, 0.05);
    if (simTimer < 0.25) return;
    simTimer = 0;
    pollWorldConditions();
  }

  function getState() {
    const sides = {};
    for (const q of SIDE_QUESTS) {
      const rec = state.sides[q.id];
      sides[q.id] = {
        status: rec.status,
        doneSteps: Array.from(rec.doneSteps),
        talkedComplete: rec.talkedComplete
      };
    }
    return {
      mainStep: state.mainStep,
      mainCompleted: state.mainCompleted,
      trackedId: state.trackedId,
      wayfinderQuestId: state.wayfinderQuestId,
      trackerCollapsed,
      sides
    };
  }

  function getStats() {
    let activeSides = 0;
    let completedSides = 0;
    for (const q of SIDE_QUESTS) {
      const st = state.sides[q.id]?.status;
      if (st === 'active') activeSides++;
      else if (st === 'completed') completedSides++;
    }
    return {
      mainStep: state.mainStep,
      mainTotal: MAIN_QUEST.steps.length,
      mainCompleted: state.mainCompleted,
      sideTotal: SIDE_QUESTS.length,
      activeSides,
      completedSides,
      trackedId: state.trackedId,
      wayfinderQuestId: state.wayfinderQuestId,
      open: isOpen(),
      trackerCollapsed,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (isOpen()) {
      try { dialogEl?.close?.(); } catch {}
      if (dialogEl) dialogEl.open = false;
    }
    doc?.body?.classList?.remove?.('quest-open');

    for (let i = cleanups.length - 1; i >= 0; i--) {
      try { cleanups[i](); } catch {}
    }
    cleanups.length = 0;

    if (wrappedMysteries) {
      wrappedMysteries.interact = prevMysteriesInteract;
      delete wrappedMysteries._questWrapped;
      wrappedMysteries = null;
    }

    if (createdOpenBtn) openBtn?.remove?.();
    if (createdTracker) trackerEl?.remove?.();
    if (createdDialog) dialogEl?.remove?.();
    if (createdToast) toastEl?.remove?.();
    if (createdStyle) styleEl?.remove?.();
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    acceptSideQuest,
    trackQuest,
    toggleWayfinder,
    clearWayfinder,
    notifyInteraction,
    notifyTalk,
    notifyJournalEvent,
    getDialogueOffer,
    getPromptHint,
    getMapMarkers,
    onDialogueSelect,
    getEarnedSeals,
    update,
    reset,
    getState,
    getStats,
    dispose
  };
}
