import { isModalBusy, isControlTarget } from './modal-state.js';

const AUDIO_HUD_STYLE_ID = 'audio-hud-styles';
const AUDIO_HUD_CSS = [
  '#sky-audio-row { pointer-events: auto; cursor: pointer; }',
  '#sky-audio-row:hover { opacity: 1; }',
  '#sky-audio-row.is-muted .sky__v { color: #5c5143; opacity: 1; }',
  'body.is-night #sky-audio-row.is-muted .sky__v { color: #b5aa95; opacity: 1; }',
  'body.ui-hidden #sky-audio-row, body.map-open #sky-audio-row { pointer-events: none !important; }'
].join('\n');

const MODE_LABELS = {
  full: { label: '畅响', toast: '雅音 · 畅响 · 山水清音' },
  soft: { label: '轻音', toast: '雅音 · 轻音 · 半敛清响' },
  mute: { label: '寂静', toast: '雅音 · 寂静 · 万籁俱寂' }
};

function isModalBlocked(doc) {
  return isModalBusy(doc);
}

function isEditableTarget(target) {
  return isControlTarget(target);
}

export function createAudioHud({ sound, doc = globalThis.document, win = globalThis.window } = {}) {
  let disposed = false;
  let rowEl = null;
  let valEl = null;
  let styleEl = null;
  let createdStyle = false;
  let createdRow = false;
  let toastTimer = null;

  if (doc?.createElement) {
    styleEl = doc.getElementById?.(AUDIO_HUD_STYLE_ID) || null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = AUDIO_HUD_STYLE_ID;
      styleEl.textContent = AUDIO_HUD_CSS;
      (doc.head || doc.body)?.appendChild?.(styleEl);
      createdStyle = true;
    }

    const skyHud = doc.getElementById?.('sky');
    rowEl = doc.getElementById?.('sky-audio-row') || null;
    valEl = doc.getElementById?.('sky-audio') || null;
    if (!rowEl && skyHud?.appendChild) {
      rowEl = doc.createElement('div');
      rowEl.className = 'sky__row';
      rowEl.id = 'sky-audio-row';
      rowEl.style.pointerEvents = 'auto';
      rowEl.style.cursor = 'pointer';

      const kSpan = doc.createElement('span');
      kSpan.className = 'sky__k';
      kSpan.textContent = '雅音';

      valEl = doc.createElement('span');
      valEl.className = 'sky__v';
      valEl.id = 'sky-audio';
      valEl.textContent = '轻音';

      const keySpan = doc.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = 'N';

      rowEl.appendChild(kSpan);
      rowEl.appendChild(valEl);
      rowEl.appendChild(keySpan);
      skyHud.appendChild(rowEl);
      createdRow = true;
    }
  }

  function showToast(text) {
    if (!text || !doc?.getElementById) return;
    const toastEl = doc.getElementById('sky-toast');
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList?.add?.('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList?.remove?.('show');
      toastTimer = null;
    }, 2400);
    if (toastTimer && typeof toastTimer.unref === 'function') toastTimer.unref();
  }

  function syncUI(prefsOverride, withToast = false) {
    const prefs = prefsOverride || sound?.getAudioPrefs?.() || { mode: 'soft', volume: 0.42, muted: false };
    const meta = MODE_LABELS[prefs.mode] || MODE_LABELS.soft;
    const label = prefs.label || meta.label;
    const isMuted = Boolean(prefs.muted || prefs.mode === 'mute' || Number(prefs.volume) <= 0.001);

    if (valEl) {
      valEl.textContent = label;
    }
    if (rowEl) {
      rowEl.title = `雅音：${label}（按 N 或点击切换：畅响 / 轻音 / 寂静）`;
      if (isMuted) rowEl.classList?.add?.('is-muted');
      else rowEl.classList?.remove?.('is-muted');
    }
    if (withToast) {
      showToast(prefs.toast || meta.toast);
    }
    return prefs;
  }

  function triggerCycle() {
    if (disposed || !sound) return null;
    sound.unlock?.();
    const next = sound.cycleAudioMode?.();
    syncUI(next, true);
    return next;
  }

  function onRowClick(e) {
    if (disposed || isModalBlocked(doc) || doc?.body?.classList?.contains?.('ui-hidden')) return;
    e?.stopPropagation?.();
    triggerCycle();
  }

  function onKeyDown(e) {
    if (disposed || !e || e.code !== 'KeyN' || e.repeat || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target) || isModalBlocked(doc)) return;
    e.preventDefault?.();
    triggerCycle();
  }

  rowEl?.addEventListener?.('click', onRowClick);
  win?.addEventListener?.('keydown', onKeyDown);
  syncUI(undefined, false);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    rowEl?.removeEventListener?.('click', onRowClick);
    win?.removeEventListener?.('keydown', onKeyDown);
    if (createdRow && rowEl) {
      rowEl.remove?.();
      rowEl.parentNode?.removeChild?.(rowEl);
    }
    if (createdStyle && styleEl) {
      styleEl.remove?.();
      styleEl.parentNode?.removeChild?.(styleEl);
    }
  }

  return {
    syncUI,
    getState: () => sound?.getAudioPrefs?.(),
    dispose
  };
}
