// 只在字幕真正可见时计时；可从游记重新观看。
export function createSubtitles(cfg, onShow) {
  let shownNotified = false;
  const el = document.getElementById('subtitle');
  let elapsed = 0;
  let running = true;
  let last = performance.now();
  if (!el) return { replay: function () {}, dispose: function () {} };
  el.textContent = cfg.text;
  function visible() {
    return !document.hidden && !document.body.classList.contains('map-open') &&
      !document.body.classList.contains('field-guide-open') &&
      !document.body.classList.contains('ui-hidden') && !document.getElementById('journal').open;
  }
  const hasCurtain = () => !!document.querySelector('.ink-curtain-half');
  function tick() {
    const now = performance.now();
    const dt = Math.min(now - last, 150);
    last = now;
    if (!running || !visible()) return;
    if (hasCurtain() && !document.body.classList.contains('curtain-open')) {
      el.style.transitionDuration = '1200ms';
      el.classList.add('show');
      return;
    }
    elapsed += dt;
    if (elapsed >= cfg.delay && elapsed < cfg.delay + cfg.fadeIn + cfg.hold) {
      el.style.transitionDuration = cfg.fadeIn + 'ms';
      el.classList.add('show');
      if (!shownNotified) {
        shownNotified = true;
        onShow?.();
      }
    } else if (elapsed >= cfg.delay + cfg.fadeIn + cfg.hold) {
      el.style.transitionDuration = cfg.fadeOut + 'ms';
      el.classList.remove('show');
      running = false;
    }
  }
  const timer = setInterval(tick, 100);
  return {
    replay: function () { elapsed = 0; last = performance.now(); running = true; shownNotified = false; el.classList.remove('show'); },
    dispose: function () { clearInterval(timer); el.classList.remove('show'); }
  };
}
