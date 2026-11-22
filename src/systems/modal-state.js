export const MODAL_BODY_CLASSES = Object.freeze([
  'map-open',
  'field-guide-open',
  'scroll-studio-open',
  'traveler-guide-open',
  'quest-open',
  'ink-epilogue-open'
]);

const MODAL_DIALOG_IDS = Object.freeze([
  'journal',
  'scroll-dialog',
  'traveler-guide',
  'quest-dialog',
  'field-guide'
]);

const CLASS_TO_DIALOG_ID = Object.freeze({
  'field-guide-open': 'field-guide',
  'scroll-studio-open': 'scroll-dialog',
  'traveler-guide-open': 'traveler-guide',
  'quest-open': 'quest-dialog'
});

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const CONTROL_SELECTOR = 'input, textarea, select, button, a[href], [contenteditable]';

export function isVeilBlocking(doc) {
  if (!doc) return false;
  const cl = doc.body?.classList;
  const veil = doc.getElementById?.('veil');
  if (!veil || veil.hidden) return false;
  const vcl = veil.classList;
  if (vcl?.contains?.('curtain-gone')) return false;
  if (vcl?.contains?.('on') || vcl?.contains?.('ink-transition') || vcl?.contains?.('ink-epilogue')) {
    return true;
  }
  return Boolean(cl && !cl.contains?.('curtain-open'));
}

export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (typeof target.closest === 'function') {
    return Boolean(target.closest(EDITABLE_SELECTOR));
  }
  return false;
}

export function isControlTarget(target) {
  if (!target) return false;
  if (isEditableTarget(target)) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'BUTTON' || tag === 'A') return true;
  if (typeof target.closest === 'function') {
    return Boolean(target.closest(CONTROL_SELECTOR));
  }
  return false;
}

function isDialogNodeOpen(node) {
  return Boolean(node && (node.open || node.hasAttribute?.('open')));
}

export function isModalBusy(doc, opts = {}) {
  const {
    ignore = null,
    includeCruise = false,
    includeUiHidden = false,
    includeVeil = false,
    includeJournal = true,
    includeDialogs = true,
    runtime = null
  } = opts || {};

  const ignored = ignore
    ? (Array.isArray(ignore) ? new Set(ignore) : new Set([ignore]))
    : null;
  if (ignored) {
    for (const [cls, dlgId] of Object.entries(CLASS_TO_DIALOG_ID)) {
      if (ignored.has(cls)) ignored.add(dlgId);
    }
  }

  if (doc) {
    const cl = doc.body?.classList;
    if (cl?.contains) {
      for (let i = 0; i < MODAL_BODY_CLASSES.length; i++) {
        const cls = MODAL_BODY_CLASSES[i];
        if (ignored?.has(cls)) continue;
        if (cl.contains(cls)) return true;
      }
      if (includeCruise && !ignored?.has('cruise-active') && cl.contains('cruise-active')) return true;
      if (includeUiHidden && !ignored?.has('ui-hidden') && cl.contains('ui-hidden')) return true;
    }

    if (includeDialogs) {
      for (let i = 0; i < MODAL_DIALOG_IDS.length; i++) {
        const id = MODAL_DIALOG_IDS[i];
        if (id === 'journal' && !includeJournal) continue;
        if (ignored?.has(id)) continue;
        if (isDialogNodeOpen(doc.getElementById?.(id))) return true;
      }
    } else if (includeJournal && !ignored?.has('journal')) {
      if (isDialogNodeOpen(doc.getElementById?.('journal'))) return true;
    }

    if (includeVeil && !ignored?.has('veil') && isVeilBlocking(doc)) {
      return true;
    }
  }

  if (runtime) {
    if (!ignored?.has('map-open') && runtime.map?.isOpen?.()) return true;
    if (includeJournal && !ignored?.has('journal') && runtime.journal?.isOpen?.()) return true;
    if (!ignored?.has('field-guide-open') && runtime.discovery?.isOpen) return true;
    if (!ignored?.has('scroll-studio-open') && runtime.scrollStudio?.isOpen?.()) return true;
    if (!ignored?.has('traveler-guide-open') && runtime.travelerGuide?.isGuideOpen?.()) return true;
    if (!ignored?.has('quest-open') && runtime.questSystem?.isOpen?.()) return true;
    if (includeCruise && !ignored?.has('cruise-active') && runtime.travelerGuide?.cruiseActive) return true;
  }

  return false;
}

export function isWorldFrozen(doc, runtime = {}) {
  if (doc?.hidden) return true;
  if (typeof doc?.hasFocus === 'function' && !doc.hasFocus()) return true;
  return isModalBusy(doc, {
    includeCruise: false,
    includeUiHidden: false,
    includeVeil: false,
    runtime
  });
}
