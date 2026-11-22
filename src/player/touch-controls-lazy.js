export function detectTouchViewport(win) {
  if (!win) return false;
  try {
    if (win.matchMedia?.('(pointer: coarse)')?.matches) return true;
  } catch {}
  const maxTouch = win.navigator?.maxTouchPoints ?? 0;
  const width = win.innerWidth ?? 1280;
  return Boolean(maxTouch > 0 && width <= 1024);
}

export function createLazyTouchControls(options = {}) {
  const doc = options.doc ?? globalThis.document;
  const win = options.win ?? globalThis.window;

  let real = null;
  let loadPromise = null;
  let disposed = false;
  let coarseQuery = null;

  function onFirstTouch() {
    void ensureLoaded();
  }

  function onCoarseChange(e) {
    if (e?.matches) void ensureLoaded();
  }

  function cleanupListeners() {
    doc?.removeEventListener?.('touchstart', onFirstTouch);
    coarseQuery?.removeEventListener?.('change', onCoarseChange);
  }

  function ensureLoaded() {
    if (disposed) return Promise.resolve(null);
    if (real) return Promise.resolve(real);
    if (loadPromise) return loadPromise;

    cleanupListeners();
    loadPromise = import('./touch-controls.js')
      .then(mod => {
        if (disposed) return null;
        const instance = mod.createTouchControls(options);
        if (disposed) {
          instance?.dispose?.();
          return null;
        }
        real = instance;
        return real;
      })
      .catch(() => null);
    return loadPromise;
  }

  if (detectTouchViewport(win)) {
    void ensureLoaded();
  } else {
    doc?.addEventListener?.('touchstart', onFirstTouch, { passive: true, once: true });
    try {
      coarseQuery = win?.matchMedia?.('(pointer: coarse)') || null;
      coarseQuery?.addEventListener?.('change', onCoarseChange);
    } catch {
      coarseQuery = null;
    }
  }

  return {
    get enabled() { return Boolean(real?.enabled); },
    get loaded() { return Boolean(real); },
    ensureLoaded,
    update(dt) {
      real?.update?.(dt);
    },
    getStats() {
      if (real) return { loaded: true, ...real.getStats() };
      return { loaded: false, enabled: false, disposed };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupListeners();
      real?.dispose?.();
      real = null;
    }
  };
}
