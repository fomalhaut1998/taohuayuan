// Fresh four-season storybook illustration cover, click-to-enter loading progress bar,
// gentle post-entry guide, valley emergence bloom, and Act 3 transition/epilogue scroll.
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];

const COVER_SEASONS = Object.freeze({
  spring: {
    id: 'spring',
    badge: '春深落英 · 东晋太元中',
    epigraph: '缘溪行 · 忘路之远近 · 忽逢桃花林',
    stage2: '点染芳华 · 植夹岸桃林',
    step1: '桃林',
    particleKind: 'petal',
    colors: [
      'rgba(251, 206, 217, 0.88)',
      'rgba(246, 179, 196, 0.84)',
      'rgba(255, 236, 240, 0.92)',
      'rgba(239, 152, 173, 0.78)'
    ],
    moteColor: '255, 249, 224'
  },
  summer: {
    id: 'summer',
    badge: '夏初新荷 · 东晋太元中',
    epigraph: '绿阴如盖 · 清塘新荷 · 舟行碧波上',
    stage2: '敷翠生阴 · 绘碧波新荷',
    step1: '碧荷',
    particleKind: 'fluff',
    colors: [
      'rgba(255, 254, 244, 0.88)',
      'rgba(222, 246, 208, 0.84)',
      'rgba(186, 234, 184, 0.78)',
      'rgba(252, 244, 196, 0.86)'
    ],
    moteColor: '234, 252, 204'
  },
  autumn: {
    id: 'autumn',
    badge: '秋熟金粟 · 东晋太元中',
    epigraph: '良田金粟 · 丹枫映水 · 霜叶满溪岸',
    stage2: '点染丹枫 · 映秋溪金粟',
    step1: '枫林',
    particleKind: 'leaf',
    colors: [
      'rgba(238, 146, 98, 0.88)',
      'rgba(246, 194, 114, 0.9)',
      'rgba(216, 102, 78, 0.84)',
      'rgba(253, 224, 154, 0.88)'
    ],
    moteColor: '255, 232, 182'
  },
  winter: {
    id: 'winter',
    badge: '冬寂薄雪 · 东晋太元中',
    epigraph: '薄雪覆岸 · 岁寒松竹 · 孤舟微灯明',
    stage2: '轻洒薄雪 · 点孤舟寒灯',
    step1: '霜雪',
    particleKind: 'snow',
    colors: [
      'rgba(255, 255, 255, 0.94)',
      'rgba(238, 246, 252, 0.88)',
      'rgba(222, 238, 248, 0.84)',
      'rgba(255, 248, 236, 0.9)'
    ],
    moteColor: '255, 244, 214'
  }
});

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function readInitialCoverSeason(params) {
  if (!params) return 'spring';
  const raw = (params.get('season') || params.get('phenology') || '').toLowerCase();
  if (COVER_SEASONS[raw]) return raw;
  if (params.get('weather') === 'snow') return 'winter';
  return 'spring';
}

export function createOpeningCurtain(options = {}) {
  const {
    sound = null,
    veilEl = typeof document !== 'undefined' ? document.getElementById('veil') : null,
    prepareEntry = null
  } = options;
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  const params = hasDom && window.location ? new URLSearchParams(window.location.search) : null;
  const autoSkipped = !!(params && (params.has('bench') || params.has('shot') || params.has('at')));
  const reducedMotion = Boolean(
    hasDom && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
  );

  let selectedSeason = readInitialCoverSeason(params);
  let open = autoSkipped;
  let entering = false;
  let loadProgress = autoSkipped ? 1 : 0;
  let bloomed = false;
  let transitioning = false;
  let epilogueOpen = false;
  let disposed = false;

  let partTimer = 0;
  let fadeTimer = 0;
  let cleanTimer = 0;
  let warmupTimer = 0;
  let finishTimer = 0;
  let loadRaf = 0;
  let loadFallbackTimer = 0;
  let ambientRaf = 0;
  let guideShowTimer = 0;
  let guideHideTimer = 0;
  let guideCleanupTimer = 0;
  let guideBound = false;
  let transShowTimer = 0;
  let transMidTimer = 0;
  let transFadeTimer = 0;
  let transEndTimer = 0;
  let epilogueShowTimer = 0;
  let epilogueCallbacks = { onLinger: null, onReplay: null };

  const enterBtn = veilEl?.querySelector?.('#cover-enter-btn') || (hasDom ? document.getElementById('cover-enter-btn') : null);
  const tipEl = veilEl?.querySelector?.('.ink-tip') || null;
  const seasonLabelEl = veilEl?.querySelector?.('#cover-season-label') || (hasDom ? document.getElementById('cover-season-label') : null);
  const epigraphEl = veilEl?.querySelector?.('#cover-epigraph') || (hasDom ? document.getElementById('cover-epigraph') : null);
  const seasonBtns = [...(veilEl?.querySelectorAll?.('.cover-season-btn') || [])];
  const loaderEl = veilEl?.querySelector?.('.cover-loader') || null;
  const stageEl = veilEl?.querySelector?.('#cover-load-stage') || (hasDom ? document.getElementById('cover-load-stage') : null);
  const percentEl = veilEl?.querySelector?.('#cover-load-percent') || (hasDom ? document.getElementById('cover-load-percent') : null);
  const trackEl = veilEl?.querySelector?.('#cover-progress-track') || (hasDom ? document.getElementById('cover-progress-track') : null);
  const fillEl = veilEl?.querySelector?.('#cover-progress-fill') || (hasDom ? document.getElementById('cover-progress-fill') : null);
  const sparkEl = veilEl?.querySelector?.('#cover-progress-spark') || (hasDom ? document.getElementById('cover-progress-spark') : null);
  const stepEls = veilEl?.querySelectorAll?.('.cover-step') || [];
  const petalsCanvas = veilEl?.querySelector?.('#cover-petals-canvas') || (hasDom ? document.getElementById('cover-petals-canvas') : null);
  const guideEl = hasDom ? document.getElementById('entry-welcome-guide') : null;
  const guideTextEl = hasDom ? document.getElementById('entry-welcome-text') : null;
  const sceneCanvas = hasDom ? document.getElementById('scene') : null;

  const transCardEl = veilEl?.querySelector?.('.ink-transition-card') || null;
  const transSealEl = veilEl?.querySelector?.('.ink-trans-seal') || null;
  const transClassicEl = veilEl?.querySelector?.('.ink-trans-classic') || null;
  const transPlainEl = veilEl?.querySelector?.('.ink-trans-plain') || null;
  const epilogueEl = veilEl?.querySelector?.('.ink-epilogue-scroll') || null;
  const lingerBtn = veilEl?.querySelector?.('#epilogue-linger') || (hasDom ? document.getElementById('epilogue-linger') : null);
  const replayBtn = veilEl?.querySelector?.('#epilogue-replay') || (hasDom ? document.getElementById('epilogue-replay') : null);

  // Ambient floating seasonal particles & gentle mouse parallax state (active only while cover is visible)
  let petalsCtx = null;
  let canvasW = 0;
  let canvasH = 0;
  let canvasDpr = 1;
  let petals = [];
  let motes = [];
  let ambientLastTs = 0;
  let targetPx = 0;
  let targetPy = 0;
  let curPx = 0;
  let curPy = 0;
  let ambientBound = false;

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function currentSeasonMeta() {
    return COVER_SEASONS[selectedSeason] || COVER_SEASONS.spring;
  }

  function loadStagesForSeason() {
    const meta = currentSeasonMeta();
    return [
      { max: 0.28, text: '研墨敷青 · 绘武陵溪山', step: 0 },
      { max: 0.60, text: meta.stage2, step: 1 },
      { max: 0.86, text: '调弦听水 · 启四时声景', step: 2 },
      { max: 0.995, text: '轻舟解缆 · 渐入桃花源', step: 3 },
      { max: 1.01, text: '画卷已展 · 豁然开朗', step: 4 }
    ];
  }

  function hideInner() {
    if (!veilEl) return;
    const nodes = veilEl.querySelectorAll?.(
      '.cover-backdrop, .cover-petals-canvas, .cover-frame, .ink-curtain-half, .ink-curtain-prompt, .ink-paper-grain'
    ) || [];
    for (const node of nodes) {
      node.style.display = 'none';
    }
  }

  function clearLoadingTimers() {
    if (!hasDom) return;
    if (warmupTimer) { window.clearTimeout?.(warmupTimer); warmupTimer = 0; }
    if (finishTimer) { window.clearTimeout?.(finishTimer); finishTimer = 0; }
    if (loadFallbackTimer) { window.clearTimeout?.(loadFallbackTimer); loadFallbackTimer = 0; }
    if (loadRaf) { window.cancelAnimationFrame?.(loadRaf); loadRaf = 0; }
  }

  function clearGuideTimersAndListeners() {
    if (!hasDom) return;
    if (guideShowTimer) { window.clearTimeout?.(guideShowTimer); guideShowTimer = 0; }
    if (guideHideTimer) { window.clearTimeout?.(guideHideTimer); guideHideTimer = 0; }
    if (guideCleanupTimer) { window.clearTimeout?.(guideCleanupTimer); guideCleanupTimer = 0; }
    if (guideBound) {
      guideBound = false;
      sceneCanvas?.removeEventListener?.('pointerdown', dismissWelcomeGuide);
      document?.removeEventListener?.('touchstart', dismissWelcomeGuide);
      window.removeEventListener?.('keydown', onGuideDismissKey);
    }
  }

  function dismissWelcomeGuide() {
    if (!guideEl) return;
    clearGuideTimersAndListeners();
    guideEl.classList?.remove('show');
    if (hasDom && typeof window.setTimeout === 'function') {
      guideCleanupTimer = window.setTimeout(() => {
        guideCleanupTimer = 0;
        if (guideEl) guideEl.hidden = true;
      }, 680);
    } else {
      guideEl.hidden = true;
    }
  }

  function onGuideDismissKey(event) {
    if (!event) return;
    if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|KeyE|KeyM|KeyJ|KeyH|KeyO|Slash)$/.test(event.code || '')) {
      dismissWelcomeGuide();
    }
  }

  function scheduleWelcomeGuide() {
    if (!hasDom || autoSkipped || disposed || !guideEl) return;
    clearGuideTimersAndListeners();
    if (typeof window.setTimeout !== 'function') return;
    guideShowTimer = window.setTimeout(() => {
      guideShowTimer = 0;
      if (disposed || transitioning || epilogueOpen) return;
      let text = '';
      try { text = prepareEntry?.getWelcomeText?.() || ''; } catch (_) {}
      if (!text) {
        const hintText = document.getElementById('hint')?.textContent || '';
        text = hintText.includes('撑篙')
          ? '轻点画面环顾溪山 · W/S 撑篙泛舟 · E 舍船登岸 · K 换四时'
          : '轻点画面环顾四周 · WASD 漫步溪岸 · E 近观交谈 · K 换四时';
      }
      if (guideTextEl) guideTextEl.textContent = text;
      guideEl.hidden = false;
      guideBound = true;
      sceneCanvas?.addEventListener?.('pointerdown', dismissWelcomeGuide);
      document?.addEventListener?.('touchstart', dismissWelcomeGuide, { passive: true });
      window.addEventListener?.('keydown', onGuideDismissKey);
      window.setTimeout(() => {
        if (!disposed && !guideEl.hidden) guideEl.classList?.add('show');
      }, 24);
      guideHideTimer = window.setTimeout(dismissWelcomeGuide, 5600);
    }, 1050);
  }

  function clearTransitionTimers() {
    if (!hasDom) return;
    if (transShowTimer) { window.clearTimeout?.(transShowTimer); transShowTimer = 0; }
    if (transMidTimer) { window.clearTimeout?.(transMidTimer); transMidTimer = 0; }
    if (transFadeTimer) { window.clearTimeout?.(transFadeTimer); transFadeTimer = 0; }
    if (transEndTimer) { window.clearTimeout?.(transEndTimer); transEndTimer = 0; }
  }

  function createParticle(x, y, burst = false) {
    const meta = currentSeasonMeta();
    const w = canvasW || 1280;
    const h = canvasH || 720;
    const rx = x !== undefined ? x : Math.random() * (w + 180) - 90;
    const ry = y !== undefined ? y : Math.random() * (h + 80) - 60;
    const angle = burst ? Math.random() * Math.PI * 2 : 0;
    const speed = burst ? 24 + Math.random() * 58 : 0;
    const isSnow = meta.particleKind === 'snow';
    const isFluff = meta.particleKind === 'fluff';
    const isLeaf = meta.particleKind === 'leaf';
    return {
      x: rx,
      y: ry,
      vx: burst ? Math.cos(angle) * speed + 14 : (isSnow ? 6 + Math.random() * 14 : isFluff ? 12 + Math.random() * 18 : 16 + Math.random() * 24),
      vy: burst ? Math.sin(angle) * speed * 0.65 + 14 : (isSnow ? 22 + Math.random() * 28 : isFluff ? 7 + Math.random() * 12 : isLeaf ? 24 + Math.random() * 28 : 18 + Math.random() * 26),
      size: isSnow ? 2.4 + Math.random() * 3.6 : isFluff ? 2.6 + Math.random() * 3.2 : isLeaf ? 5.2 + Math.random() * 5.8 : 4.2 + Math.random() * 5.6,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * (isSnow ? 0.6 : 1.6),
      phase: Math.random() * Math.PI * 2,
      swayAmp: isSnow ? 16 + Math.random() * 20 : 12 + Math.random() * 18,
      swayFreq: 0.7 + Math.random() * 0.9,
      flipSpeed: 1.2 + Math.random() * 1.4,
      color: meta.colors[(Math.random() * meta.colors.length) | 0],
      alpha: 0.55 + Math.random() * 0.42,
      life: burst ? 1.0 : -1
    };
  }

  function seedAmbience() {
    const w = canvasW || 1280;
    const h = canvasH || 720;
    const count = w < 720 ? 24 : 42;
    petals = Array.from({ length: count }, () => createParticle());
    motes = Array.from({ length: w < 720 ? 12 : 22 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.85,
      r: 1.1 + Math.random() * 2.1,
      vy: -4 - Math.random() * 6,
      vx: 3 + Math.random() * 7,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.42
    }));
  }

  function resizePetalsCanvas() {
    if (!petalsCanvas || !hasDom) return;
    canvasW = Math.max(1, window.innerWidth || 1280);
    canvasH = Math.max(1, window.innerHeight || 720);
    canvasDpr = Math.min(window.devicePixelRatio || 1, 2);
    petalsCanvas.width = Math.round(canvasW * canvasDpr);
    petalsCanvas.height = Math.round(canvasH * canvasDpr);
    if (petalsCtx && typeof petalsCtx.setTransform === 'function') {
      petalsCtx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    }
  }

  function drawSeasonalParticle(ctx, size, kind) {
    if (kind === 'snow') {
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (kind === 'fluff') {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.42;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.9, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (kind === 'leaf') {
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.15);
      ctx.quadraticCurveTo(size * 0.82, -size * 0.1, 0, size * 1.05);
      ctx.quadraticCurveTo(-size * 0.82, -size * 0.1, 0, -size * 1.15);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.78, -size * 0.72, size * 0.88, size * 0.36, 0, size * 0.92);
    ctx.bezierCurveTo(-size * 0.88, size * 0.36, -size * 0.78, -size * 0.72, 0, -size);
    ctx.closePath();
    ctx.fill();
  }

  function stepAmbience(ts) {
    if (disposed || open || !petalsCtx) {
      ambientRaf = 0;
      return;
    }
    const dt = ambientLastTs ? Math.min(0.05, Math.max(0.004, (ts - ambientLastTs) / 1000)) : 0.016;
    ambientLastTs = ts;
    const meta = currentSeasonMeta();

    if (veilEl?.style?.setProperty && !reducedMotion) {
      const k = Math.min(1, dt * 4.5);
      curPx += (targetPx - curPx) * k;
      curPy += (targetPy - curPy) * k;
      veilEl.style.setProperty('--cover-px', curPx.toFixed(4));
      veilEl.style.setProperty('--cover-py', curPy.toFixed(4));
    }

    petalsCtx.clearRect(0, 0, canvasW, canvasH);

    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.phase += dt * 1.4;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -12) { m.y = canvasH * 0.85; m.x = Math.random() * canvasW; }
      if (m.x > canvasW + 12) m.x = -12;
      const glow = m.alpha * (0.58 + 0.42 * Math.sin(m.phase));
      petalsCtx.fillStyle = `rgba(${meta.moteColor}, ${glow.toFixed(3)})`;
      petalsCtx.beginPath();
      petalsCtx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      petalsCtx.fill();
    }

    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.phase += dt * p.swayFreq;
      p.rot += p.vrot * dt;
      if (p.life > 0) {
        p.vx += (18 - p.vx) * Math.min(1, dt * 1.8);
        p.vy += (22 - p.vy) * Math.min(1, dt * 1.8);
        p.life -= dt * 0.34;
        if (p.life <= 0) {
          petals.splice(i, 1);
          continue;
        }
      }
      p.x += (p.vx + Math.sin(p.phase) * p.swayAmp) * dt;
      p.y += p.vy * dt;

      if (p.life < 0 && (p.y > canvasH + 26 || p.x > canvasW + 34)) {
        if (Math.random() < 0.65) {
          p.x = Math.random() * canvasW * 1.05 - canvasW * 0.12;
          p.y = -18 - Math.random() * 24;
        } else {
          p.x = -18 - Math.random() * 24;
          p.y = Math.random() * canvasH * 0.68;
        }
      }

      const flip = meta.particleKind === 'snow' || meta.particleKind === 'fluff'
        ? 1
        : 0.38 + 0.62 * Math.abs(Math.cos(p.phase * p.flipSpeed));
      const fade = p.life > 0 ? Math.min(1, p.life * 1.6) * p.alpha : p.alpha;
      petalsCtx.save();
      petalsCtx.translate(p.x, p.y);
      petalsCtx.rotate(p.rot);
      petalsCtx.scale(1, flip);
      petalsCtx.globalAlpha = fade;
      petalsCtx.fillStyle = p.color;
      drawSeasonalParticle(petalsCtx, p.size, meta.particleKind);
      petalsCtx.restore();
    }

    if (!reducedMotion && typeof window.requestAnimationFrame === 'function') {
      ambientRaf = window.requestAnimationFrame(stepAmbience);
    } else {
      ambientRaf = 0;
    }
  }

  function onCoverPointerMove(event) {
    if (!hasDom || open || reducedMotion || !event) return;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    targetPx = Math.max(-1, Math.min(1, (event.clientX / w - 0.5) * 2));
    targetPy = Math.max(-1, Math.min(1, (event.clientY / h - 0.5) * 2));
  }

  function onCoverPointerLeave() {
    targetPx = 0;
    targetPy = 0;
  }

  function onVeilBackdropClick(event) {
    if (open || disposed || !event) return;
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('#cover-enter-btn, .cover-season-bar')) {
      return;
    }
    if (petalsCtx && !reducedMotion && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const cap = 68;
      for (let i = 0; i < 7 && petals.length < cap; i++) {
        petals.push(createParticle(event.clientX, event.clientY, true));
      }
    }
  }

  function startCoverAmbience() {
    if (!hasDom || open || disposed || ambientBound) return;
    if (petalsCanvas && typeof petalsCanvas.getContext === 'function') {
      try {
        petalsCtx = petalsCanvas.getContext('2d');
      } catch (_) {
        petalsCtx = null;
      }
    }
    if (!petalsCtx) return;
    ambientBound = true;
    resizePetalsCanvas();
    seedAmbience();
    window.addEventListener?.('resize', resizePetalsCanvas);
    veilEl?.addEventListener?.('pointermove', onCoverPointerMove);
    veilEl?.addEventListener?.('pointerleave', onCoverPointerLeave);
    veilEl?.addEventListener?.('click', onVeilBackdropClick);
    ambientLastTs = 0;
    if (reducedMotion) {
      stepAmbience(nowMs());
    } else if (typeof window.requestAnimationFrame === 'function') {
      ambientRaf = window.requestAnimationFrame(stepAmbience);
    }
  }

  function stopCoverAmbience() {
    if (hasDom && ambientRaf) {
      window.cancelAnimationFrame?.(ambientRaf);
      ambientRaf = 0;
    }
    if (ambientBound && hasDom) {
      ambientBound = false;
      window.removeEventListener?.('resize', resizePetalsCanvas);
      veilEl?.removeEventListener?.('pointermove', onCoverPointerMove);
      veilEl?.removeEventListener?.('pointerleave', onCoverPointerLeave);
      veilEl?.removeEventListener?.('click', onVeilBackdropClick);
    }
    if (petalsCtx && canvasW > 0 && canvasH > 0) {
      try { petalsCtx.clearRect(0, 0, canvasW, canvasH); } catch (_) {}
    }
    petals = [];
    motes = [];
  }

  function applyCoverSeasonUi(id, withSwirl = false) {
    const meta = COVER_SEASONS[id] || COVER_SEASONS.spring;
    selectedSeason = meta.id;
    veilEl?.setAttribute?.('data-cover-season', meta.id);
    if (seasonLabelEl) seasonLabelEl.textContent = meta.badge;
    if (epigraphEl) epigraphEl.textContent = meta.epigraph;
    if (stepEls && stepEls[1]) {
      // Preserve leading <i> diamond marker while refreshing step-1 season label
      const stepEl = stepEls[1];
      if (stepEl.lastChild && stepEl.lastChild.nodeType === 3) {
        stepEl.lastChild.textContent = meta.step1;
      }
    }
    for (const btn of seasonBtns) {
      const btnSeason = btn.dataset?.season || btn.getAttribute?.('data-season');
      const active = btnSeason === meta.id;
      btn.classList?.toggle?.('is-active', active);
      btn.setAttribute?.('aria-checked', active ? 'true' : 'false');
    }
    if (petalsCtx) {
      for (let i = 0; i < petals.length; i++) {
        petals[i].color = meta.colors[i % meta.colors.length];
      }
      if (withSwirl && !reducedMotion) {
        const sx = (canvasW || 1280) * 0.78;
        const sy = (canvasH || 720) * 0.16;
        for (let i = 0; i < 8 && petals.length < 68; i++) {
          petals.push(createParticle(sx, sy, true));
        }
      } else if (reducedMotion) {
        stepAmbience(nowMs());
      }
    }
    return true;
  }

  function setSeason(id) {
    if (disposed || open || entering || !COVER_SEASONS[id]) return false;
    applyCoverSeasonUi(id, true);
    return true;
  }

  function renderProgress(p) {
    const clamped = clamp01(p);
    loadProgress = clamped;
    const pct = Math.round(clamped * 100);
    const pctCss = (clamped * 100).toFixed(2) + '%';

    if (fillEl?.style) fillEl.style.width = pctCss;
    if (sparkEl?.style) sparkEl.style.left = pctCss;
    if (percentEl) percentEl.textContent = `${pct}%`;
    if (trackEl) trackEl.setAttribute?.('aria-valuenow', String(pct));

    const stages = loadStagesForSeason();
    let stage = stages[stages.length - 1];
    for (let i = 0; i < stages.length; i++) {
      if (clamped < stages[i].max) {
        stage = stages[i];
        break;
      }
    }
    if (stageEl && stageEl.textContent !== stage.text) {
      stageEl.textContent = stage.text;
    }
    if (stepEls && stepEls.length) {
      for (let i = 0; i < stepEls.length; i++) {
        const el = stepEls[i];
        const done = i < stage.step || clamped >= 0.999;
        const active = !done && i === stage.step;
        el.classList?.toggle?.('is-done', done);
        el.classList?.toggle?.('is-active', active);
      }
    }
  }

  function readRealCeiling(elapsedMs) {
    if (!prepareEntry || typeof prepareEntry.getProgress !== 'function') {
      return 1;
    }
    let snap = null;
    try {
      snap = prepareEntry.getProgress();
    } catch (_) {
      return 1;
    }
    if (!snap || typeof snap !== 'object') return 1;

    const runtimeReady = snap.runtimeReady !== false;
    const shadersReady = snap.shadersReady !== false;
    const framesReady = snap.framesReady !== false;
    const rawAudio = Number.isFinite(snap.audioRatio) ? clamp01(snap.audioRatio) : 1;

    if (!runtimeReady && elapsedMs < 2200) return 0.24;
    if (!shadersReady && elapsedMs < 2500) return 0.56;
    const audioCeiling = elapsedMs >= 2100 ? 0.92 : 0.66 + rawAudio * 0.26;
    if (audioCeiling < 0.919) return audioCeiling;
    if (!framesReady && elapsedMs < 2600) return 0.94;
    return 1;
  }

  function completeLoading() {
    if (disposed || open) return;
    renderProgress(1);
    veilEl?.classList?.add('cover-loaded');
    const holdMs = reducedMotion ? 90 : 260;
    if (hasDom && typeof window.setTimeout === 'function') {
      finishTimer = window.setTimeout(() => {
        finishTimer = 0;
        openNow(true);
      }, holdMs);
    } else {
      openNow(true);
    }
  }

  function startEntry() {
    if (disposed || open || entering || epilogueOpen) return false;
    entering = true;
    sound?.unlock?.();
    try {
      if (sound && !sound.muted && typeof sound.guqinPluck === 'function') {
        sound.guqinPluck(undefined, undefined, 2);
      }
    } catch (_) {}

    if (enterBtn) {
      enterBtn.disabled = true;
      enterBtn.setAttribute?.('aria-disabled', 'true');
    }
    for (const btn of seasonBtns) {
      btn.disabled = true;
    }
    if (loaderEl) loaderEl.hidden = false;
    veilEl?.classList?.add('cover-loading');
    if (hasDom) document.body?.classList?.add('cover-loading');
    renderProgress(0.04);

    if (hasDom && typeof window.setTimeout === 'function') {
      warmupTimer = window.setTimeout(() => {
        warmupTimer = 0;
        if (!disposed && !open) {
          try { prepareEntry?.triggerWarmup?.(selectedSeason); } catch (_) {}
        }
      }, 65);
    } else {
      try { prepareEntry?.triggerWarmup?.(selectedSeason); } catch (_) {}
    }

    const minDuration = reducedMotion ? 420 : 1480;
    const startedAt = nowMs();
    let lastTickAt = startedAt;
    let display = 0.04;

    if (!hasDom || typeof window.requestAnimationFrame !== 'function') {
      const steps = [0.26, 0.58, 0.84, 1.0];
      let idx = 0;
      const advanceFallback = () => {
        if (disposed || open) return;
        const p = steps[idx++];
        renderProgress(p);
        if (idx < steps.length && typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
          loadFallbackTimer = window.setTimeout(advanceFallback, 180);
        } else {
          loadFallbackTimer = 0;
          completeLoading();
        }
      };
      if (hasDom && typeof window.setTimeout === 'function') {
        loadFallbackTimer = window.setTimeout(advanceFallback, 140);
      } else {
        completeLoading();
      }
      return true;
    }

    function tickLoad(ts) {
      if (disposed || open) {
        loadRaf = 0;
        return;
      }
      const now = Number.isFinite(ts) ? ts : nowMs();
      const elapsed = Math.max(0, now - startedAt);
      const dt = Math.min(0.06, Math.max(0.008, (now - lastTickAt) / 1000));
      lastTickAt = now;

      const tNorm = clamp01(elapsed / minDuration);
      const ease = 1 - Math.pow(1 - tNorm, 2.25);
      const cadence = Math.sin(tNorm * Math.PI * 2) * 0.022 * (1 - tNorm);
      const choreo = clamp01(0.04 + (ease + cadence) * 0.96);
      const realCeiling = readRealCeiling(elapsed);
      const target = tNorm >= 1 && realCeiling >= 0.999 ? 1 : Math.min(choreo, realCeiling);

      display += (target - display) * Math.min(1, dt * 9.5);
      if (target >= 0.999 && display >= 0.992) {
        display = 1;
      }
      renderProgress(display);

      if (display >= 1) {
        loadRaf = 0;
        completeLoading();
        return;
      }
      loadRaf = window.requestAnimationFrame(tickLoad);
    }

    loadRaf = window.requestAnimationFrame(tickLoad);
    return true;
  }

  function openNow(showGuide = false) {
    if (disposed || open) return;
    open = true;
    entering = false;
    loadProgress = 1;
    clearLoadingTimers();
    stopCoverAmbience();
    sound?.unlock?.();
    if (hasDom) {
      document.body?.classList?.remove('cover-loading');
      document.body?.classList?.add('curtain-parting');
      document.body?.classList?.add('curtain-open');
      veilEl?.classList?.remove('cover-loading', 'cover-loaded');
      veilEl?.setAttribute?.('aria-hidden', 'true');
      partTimer = window.setTimeout?.(() => {
        if (!disposed) {
          document.body?.classList?.remove('curtain-parting');
          hideInner();
        }
      }, 1550) || 0;
      if (showGuide) scheduleWelcomeGuide();
    }
    detachListeners();
  }

  function onEnterClick(event) {
    event?.stopPropagation?.();
    startEntry();
  }

  function onSeasonClick(event) {
    event?.stopPropagation?.();
    const btn = event?.currentTarget;
    const next = btn?.dataset?.season || btn?.getAttribute?.('data-season');
    if (next) setSeason(next);
  }

  function onKey(event) {
    if (!event || open || entering || epilogueOpen) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^Digit[1-4]$/.test(event.code || '')) {
      const idx = Number(event.code.slice(5)) - 1;
      if (SEASON_ORDER[idx]) {
        event.preventDefault?.();
        setSeason(SEASON_ORDER[idx]);
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') {
      const activeEl = hasDom ? document.activeElement : null;
      if (activeEl && activeEl.classList?.contains?.('cover-season-btn')) return;
      event.preventDefault?.();
      startEntry();
    }
  }

  function attachListeners() {
    if (!hasDom || autoSkipped) return;
    if (tipEl && (window.matchMedia?.('(pointer: coarse)')?.matches || (window.innerWidth ?? 1440) <= 720 || ((window.navigator?.maxTouchPoints ?? 0) > 0 && (window.innerWidth ?? 1440) <= 1180))) {
      tipEl.textContent = '轻触「轻舟入画」启程 · 开启山水声景';
    }
    enterBtn?.addEventListener?.('click', onEnterClick);
    for (const btn of seasonBtns) {
      btn.addEventListener?.('click', onSeasonClick);
    }
    window.addEventListener?.('keydown', onKey);
    startCoverAmbience();
  }

  function detachListeners() {
    if (!hasDom) return;
    enterBtn?.removeEventListener?.('click', onEnterClick);
    for (const btn of seasonBtns) {
      btn.removeEventListener?.('click', onSeasonClick);
    }
    window.removeEventListener?.('keydown', onKey);
  }

  function hideEpilogue() {
    if (!epilogueOpen && !(veilEl?.classList?.contains?.('ink-epilogue'))) return false;
    epilogueOpen = false;
    if (hasDom && epilogueShowTimer) {
      window.clearTimeout?.(epilogueShowTimer);
      epilogueShowTimer = 0;
    }
    if (epilogueEl) epilogueEl.hidden = true;
    veilEl?.classList?.remove('ink-epilogue', 'show');
    veilEl?.setAttribute?.('aria-hidden', 'true');
    if (hasDom) {
      document.body?.classList?.remove('ink-epilogue-open');
      window.removeEventListener?.('keydown', onEpilogueKey);
    }
    return true;
  }

  function handleLinger(event) {
    event?.stopPropagation?.();
    if (disposed || !epilogueOpen) return;
    const fn = epilogueCallbacks.onLinger;
    hideEpilogue();
    fn?.();
  }

  function handleReplay(event) {
    event?.stopPropagation?.();
    if (disposed || !epilogueOpen) return;
    const fn = epilogueCallbacks.onReplay;
    hideEpilogue();
    fn?.();
  }

  function onEpilogueKey(event) {
    if (!epilogueOpen || disposed || !event) return;
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Digit1' || event.code === 'Escape') {
      event.preventDefault?.();
      handleLinger(event);
    } else if (event.code === 'Digit2' || event.code === 'KeyR') {
      event.preventDefault?.();
      handleReplay(event);
    }
  }

  lingerBtn?.addEventListener?.('click', handleLinger);
  replayBtn?.addEventListener?.('click', handleReplay);

  applyCoverSeasonUi(selectedSeason, false);
  if (autoSkipped && hasDom) {
    document.body?.classList?.add('curtain-open');
    veilEl?.setAttribute?.('aria-hidden', 'true');
    hideInner();
  } else {
    attachListeners();
  }

  function triggerValleyBloom() {
    if (disposed || bloomed) return false;
    bloomed = true;
    if (!veilEl || !hasDom) return true;
    hideInner();
    veilEl.classList?.remove('fade');
    veilEl.classList?.add('valley-bloom');
    fadeTimer = window.setTimeout?.(() => {
      if (!disposed) veilEl.classList?.add('fade');
    }, 180) || 0;
    cleanTimer = window.setTimeout?.(() => {
      if (!disposed) veilEl.classList?.remove('valley-bloom', 'fade');
    }, 1800) || 0;
    return true;
  }

  function resetValleyBloom() {
    bloomed = false;
    if (veilEl) veilEl.classList?.remove('valley-bloom', 'fade');
  }

  function triggerInkTransition(opts = {}) {
    if (disposed) return false;
    if (!open) openNow(false);
    dismissWelcomeGuide();
    clearTransitionTimers();
    hideEpilogue();
    hideInner();
    transitioning = true;

    const {
      seal = '复寻',
      classic = '',
      plain = '',
      holdMs = 1950,
      onMidpoint = null,
      onComplete = null
    } = opts;

    if (transSealEl) transSealEl.textContent = seal;
    if (transClassicEl) transClassicEl.textContent = classic;
    if (transPlainEl) transPlainEl.textContent = plain;
    if (transCardEl) transCardEl.hidden = false;

    if (veilEl) {
      veilEl.classList?.remove('valley-bloom', 'fade', 'ink-epilogue');
      veilEl.classList?.add('ink-transition');
      veilEl.setAttribute?.('aria-hidden', 'false');
    }

    if (!hasDom || typeof window.setTimeout !== 'function') {
      onMidpoint?.();
      transitioning = false;
      if (transCardEl) transCardEl.hidden = true;
      veilEl?.classList?.remove('ink-transition', 'show', 'fade');
      veilEl?.setAttribute?.('aria-hidden', 'true');
      onComplete?.();
      return true;
    }

    transShowTimer = window.setTimeout(() => {
      if (!disposed) veilEl?.classList?.add('show');
    }, 20);
    transMidTimer = window.setTimeout(() => {
      if (!disposed) onMidpoint?.();
    }, 760);
    transFadeTimer = window.setTimeout(() => {
      if (!disposed) veilEl?.classList?.add('fade');
    }, 760 + holdMs);
    transEndTimer = window.setTimeout(() => {
      if (disposed) return;
      transitioning = false;
      if (transCardEl) transCardEl.hidden = true;
      veilEl?.classList?.remove('ink-transition', 'show', 'fade');
      veilEl?.setAttribute?.('aria-hidden', 'true');
      onComplete?.();
    }, 760 + holdMs + 1080);
    return true;
  }

  function showEpilogue(opts = {}) {
    if (disposed) return false;
    if (!open) openNow(false);
    dismissWelcomeGuide();
    clearTransitionTimers();
    transitioning = false;
    if (transCardEl) transCardEl.hidden = true;
    veilEl?.classList?.remove('ink-transition', 'valley-bloom', 'fade');

    epilogueCallbacks = {
      onLinger: typeof opts.onLinger === 'function' ? opts.onLinger : null,
      onReplay: typeof opts.onReplay === 'function' ? opts.onReplay : null
    };
    epilogueOpen = true;
    hideInner();

    if (hasDom) {
      try {
        if (document.pointerLockElement) document.exitPointerLock?.();
      } catch (_) {}
      document.body?.classList?.add('ink-epilogue-open');
      window.addEventListener?.('keydown', onEpilogueKey);
    }

    if (epilogueEl) epilogueEl.hidden = false;
    if (veilEl) {
      veilEl.classList?.add('ink-epilogue');
      veilEl.setAttribute?.('aria-hidden', 'false');
    }

    if (hasDom && typeof window.setTimeout === 'function') {
      epilogueShowTimer = window.setTimeout(() => {
        if (!disposed && epilogueOpen) veilEl?.classList?.add('show');
      }, 24);
    } else {
      veilEl?.classList?.add('show');
    }
    return true;
  }

  return {
    isOpen: () => open,
    isEntering: () => entering,
    getSeason: () => selectedSeason,
    setSeason,
    getLoadProgress: () => loadProgress,
    isTransitioning: () => transitioning,
    isEpilogueOpen: () => epilogueOpen,
    startEntry,
    openNow,
    dismissWelcomeGuide,
    triggerValleyBloom,
    resetValleyBloom,
    triggerInkTransition,
    showEpilogue,
    hideEpilogue,
    getStats: () => ({ open, entering, season: selectedSeason, loadProgress, bloomed, autoSkipped, transitioning, epilogueOpen }),
    dispose() {
      if (disposed) return;
      disposed = true;
      detachListeners();
      stopCoverAmbience();
      clearLoadingTimers();
      clearGuideTimersAndListeners();
      if (guideEl) {
        guideEl.classList?.remove('show');
        guideEl.hidden = true;
      }
      lingerBtn?.removeEventListener?.('click', handleLinger);
      replayBtn?.removeEventListener?.('click', handleReplay);
      hideEpilogue();
      clearTransitionTimers();
      if (transCardEl) transCardEl.hidden = true;
      veilEl?.classList?.remove('cover-loading', 'cover-loaded', 'ink-transition', 'ink-epilogue', 'valley-bloom', 'show', 'fade');
      if (hasDom) {
        document.body?.classList?.remove('cover-loading');
        if (partTimer) window.clearTimeout?.(partTimer);
        if (fadeTimer) window.clearTimeout?.(fadeTimer);
        if (cleanTimer) window.clearTimeout?.(cleanTimer);
        if (epilogueShowTimer) window.clearTimeout?.(epilogueShowTimer);
        window.removeEventListener?.('keydown', onEpilogueKey);
      }
    }
  };
}
