import { isModalBusy, isEditableTarget } from './modal-state.js';

const SERIF_FONT = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif';
const STORAGE_KEY = 'taohua.scrolls.v1';
const SHELL_STYLE_ID = 'scroll-open-shell-styles';

const SHELL_CSS = `
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
`;

function findDescendant(root, pred) {
  if (!root || !Array.isArray(root.children)) return null;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (pred(child)) return child;
    const nested = findDescendant(child, pred);
    if (nested) return nested;
  }
  return null;
}

function readLocalScrolls(win) {
  const storage = win?.localStorage ?? globalThis.localStorage;
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(item => ({ ...item })) : [];
  } catch {
    return [];
  }
}

export function createLazyScrollStudio(options = {}) {
  const doc = options.doc ?? globalThis.document;
  const win = options.win ?? globalThis.window;

  let real = null;
  let loadPromise = null;
  let disposed = false;

  let shellStyleEl = null;
  let createdShellStyle = false;
  let shellOpenBtn = null;
  let createdShellOpenBtn = false;
  let shellTabBtn = null;
  let createdShellTabBtn = false;

  function removeEl(el) {
    if (!el) return;
    if (typeof el.remove === 'function') el.remove();
    else el.parentNode?.removeChild?.(el);
  }

  function detachShellListeners() {
    shellOpenBtn?.removeEventListener?.('click', onShellOpenClick);
    shellTabBtn?.removeEventListener?.('click', onShellTabScrollsClick);
    win?.removeEventListener?.('keydown', onShellKeyDown, true);
  }

  function ensureLoaded() {
    if (disposed) return Promise.resolve(null);
    if (real) return Promise.resolve(real);
    if (loadPromise) return loadPromise;

    detachShellListeners();
    loadPromise = import('./scroll-studio.js')
      .then(mod => {
        if (disposed) return null;
        const instance = mod.createScrollStudio(options);
        if (disposed) {
          instance?.dispose?.();
          return null;
        }
        real = instance;
        if (createdShellStyle && shellStyleEl && doc?.getElementById?.('scroll-studio-styles')) {
          removeEl(shellStyleEl);
          shellStyleEl = null;
          createdShellStyle = false;
        }
        return real;
      })
      .catch(() => null);

    return loadPromise;
  }

  function onShellOpenClick() {
    void ensureLoaded().then(studio => {
      if (studio && !disposed) studio.openCapture?.(false);
    });
  }

  function onShellTabScrollsClick() {
    void ensureLoaded().then(studio => {
      if (studio && !disposed) {
        doc?.getElementById?.('journal-tab-scrolls')?.click?.();
      }
    });
  }

  function onShellKeyDown(event) {
    if (disposed || real || !event) return;
    if (event.code !== 'KeyO' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (isModalBusy(doc, {
      ignore: 'scroll-studio-open',
      includeVeil: true,
      includeCruise: false,
      runtime: { map: options.map, journal: options.journal }
    })) {
      return;
    }
    event.preventDefault?.();
    void ensureLoaded().then(studio => {
      if (studio && !disposed) studio.openCapture?.(true);
    });
  }

  if (doc?.createElement) {
    shellStyleEl = doc.getElementById?.(SHELL_STYLE_ID) || doc.getElementById?.('scroll-studio-styles') || null;
    if (!shellStyleEl) {
      shellStyleEl = doc.createElement('style');
      shellStyleEl.id = SHELL_STYLE_ID;
      shellStyleEl.textContent = SHELL_CSS;
      (doc.head || doc.body || doc.documentElement)?.appendChild?.(shellStyleEl);
      createdShellStyle = true;
    }

    shellOpenBtn = doc.getElementById?.('scroll-open') || null;
    if (!shellOpenBtn && doc.body) {
      shellOpenBtn = doc.createElement('button');
      shellOpenBtn.id = 'scroll-open';
      shellOpenBtn.className = 'scroll-open';
      shellOpenBtn.type = 'button';
      shellOpenBtn.setAttribute?.('aria-keyshortcuts', 'O');
      shellOpenBtn.textContent = '丹青 ';
      const keySpan = doc.createElement('span');
      keySpan.textContent = 'O';
      shellOpenBtn.appendChild?.(keySpan);
      const dockHost = doc.getElementById?.('hud-top-dock') || doc.body;
      dockHost.appendChild?.(shellOpenBtn);
      createdShellOpenBtn = true;
    }
    shellOpenBtn?.addEventListener?.('click', onShellOpenClick);

    const journalEl = doc.getElementById?.('journal') || null;
    if (journalEl) {
      const tabFieldBtn = doc.getElementById?.('journal-tab-field') || null;
      const tabsNav = doc.getElementById?.('journal-tabs') ||
        journalEl.querySelector?.('.journal__tabs') ||
        findDescendant(journalEl, n => typeof n.className === 'string' && n.className.includes('journal__tabs')) ||
        (tabFieldBtn?.parentNode && tabFieldBtn.parentNode !== journalEl ? tabFieldBtn.parentNode : null) ||
        journalEl;

      shellTabBtn = doc.getElementById?.('journal-tab-scrolls') || null;
      if (!shellTabBtn) {
        shellTabBtn = doc.createElement('button');
        shellTabBtn.type = 'button';
        shellTabBtn.id = 'journal-tab-scrolls';
        shellTabBtn.setAttribute?.('aria-pressed', 'false');
        shellTabBtn.textContent = '画匣';
        tabsNav?.appendChild?.(shellTabBtn);
        createdShellTabBtn = true;
      }
      shellTabBtn?.addEventListener?.('click', onShellTabScrollsClick);
    }
  }

  win?.addEventListener?.('keydown', onShellKeyDown, true);

  function isOpen() {
    return Boolean(real?.isOpen?.());
  }

  function close() {
    return Boolean(real?.close?.());
  }

  function getSavedScrolls() {
    if (real) return real.getSavedScrolls();
    return readLocalScrolls(win);
  }

  function openCapture(fromKeyboard = false, opts = null) {
    if (real) return real.openCapture(fromKeyboard, opts);
    return ensureLoaded().then(s => (s ? s.openCapture(fromKeyboard, opts) : false));
  }

  function enterScrollWorld(target) {
    if (real) return real.enterScrollWorld(target);
    return ensureLoaded().then(s => (s ? s.enterScrollWorld(target) : false));
  }

  function getStats() {
    if (real) return { loaded: true, ...real.getStats() };
    return {
      loaded: false,
      open: false,
      savedCount: getSavedScrolls().length,
      storageKey: STORAGE_KEY,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachShellListeners();
    if (real) {
      real.dispose();
    }
    if (createdShellStyle && shellStyleEl) {
      removeEl(shellStyleEl);
      shellStyleEl = null;
    }
    if (createdShellOpenBtn && shellOpenBtn) {
      removeEl(shellOpenBtn);
      shellOpenBtn = null;
    }
    if (createdShellTabBtn && shellTabBtn) {
      removeEl(shellTabBtn);
      shellTabBtn = null;
    }
  }

  return {
    get loaded() { return Boolean(real); },
    ensureLoaded,
    openCapture,
    close,
    isOpen,
    setBrushStyle: (id) => (real ? real.setBrushStyle(id) : false),
    setCustomInscription: (opts) => (real ? real.setCustomInscription(opts) : null),
    getCustomInscription: () => (real ? real.getCustomInscription() : { verse: '', seal: '', sealStyle: 'zhuwen' }),
    getAvailableQuestSeals: () => (real ? real.getAvailableQuestSeals() : []),
    captureScrollDataUrl: (opts) => (real ? real.captureScrollDataUrl(opts) : ensureLoaded().then(s => s?.captureScrollDataUrl?.(opts) ?? null)),
    downloadSavedScroll: (id) => (real ? real.downloadSavedScroll(id) : ensureLoaded().then(s => s?.downloadSavedScroll?.(id) ?? false)),
    removeSavedScroll: (id) => (real ? real.removeSavedScroll(id) : false),
    enterScrollWorld,
    exportPanoramicScroll: (opts) => (real ? real.exportPanoramicScroll(opts) : ensureLoaded().then(s => s?.exportPanoramicScroll?.(opts) ?? false)),
    getSavedScrolls,
    setGallerySeasonFilter: (id) => (real ? real.setGallerySeasonFilter(id) : false),
    getGallerySeasonFilter: () => (real ? real.getGallerySeasonFilter() : 'all'),
    clearSavedScrolls: () => real?.clearSavedScrolls?.(),
    getStats,
    dispose
  };
}

export { createLazyScrollStudio as createScrollStudio };
