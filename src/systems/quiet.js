// Optional moments of stillness leave the world running and can always be exited.
import { isModalBusy, isControlTarget } from './modal-state.js';

export function createQuiet(player, canvas, spots = [], options = {}) {
  const doc = options?.doc || (typeof document !== 'undefined' ? document : null);
  const win = options?.win || (typeof window !== 'undefined' ? window : null);
  const onChange = typeof options?.onChange === 'function' ? options.onChange : null;
  const notice = doc?.getElementById?.('quiet-notice') || null;
  const exitBtn = doc?.getElementById?.('quiet-exit') || null;

  const spotList = [];
  let active = false;
  let nearby = null;

  function addSpots(moreSpots) {
    if (!moreSpots) return spotList.length;
    const list = Array.isArray(moreSpots) ? moreSpots : [moreSpots];
    for (const s of list) {
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const radius = Number.isFinite(s.radius) && s.radius > 0 ? s.radius : 8;
      const dup = spotList.some(
        item => item === s || (item.name === s.name && Math.hypot(item.x - s.x, item.z - s.z) < 0.25)
      );
      if (!dup) spotList.push({ ...s, radius });
    }
    refreshNearby();
    return spotList.length;
  }

  function refreshNearby() {
    nearby = null;
    const ps = player?.state;
    if (!ps || !Number.isFinite(ps.x) || !Number.isFinite(ps.z)) return null;
    for (const spot of spotList) {
      const d = Math.hypot(ps.x - spot.x, ps.z - spot.z);
      if (d < spot.radius && (!nearby || d < nearby.d)) {
        nearby = { ...spot, d };
      }
    }
    return nearby;
  }

  function isFlightMode() {
    return Boolean(
      doc?.body?.classList?.contains?.('god-flight') ||
      doc?.body?.classList?.contains?.('cruise-active') ||
      player?.state?.godFlight
    );
  }

  function isModalOpen() {
    return isModalBusy(doc, { includeUiHidden: true });
  }

  function setActive( next ) {
    const on = Boolean(next);
    const changed = on !== active;
    active = on;
    refreshNearby();
    if (player?.state) {
      player.state.still = on || Boolean(player.state.aboardSkiff || player.state.seated);
      if (on) {
        player.state.vx = 0;
        player.state.vz = 0;
        player.state.speed = 0;
      }
    }
    if (exitBtn) exitBtn.hidden = !on;
    update();
    if (changed) {
      onChange?.(active, nearby);
    }
  }

  let lastSky = null;
  let lastPhenology = null;

  function update(sky = lastSky, phenology = lastPhenology) {
    lastSky = sky;
    lastPhenology = phenology;
    if (active && Math.hypot(player?.state?.touchMoveX || 0, player?.state?.touchMoveZ || 0) > 0.25) {
      setActive(false);
      return;
    }
    refreshNearby();
    const modal = isModalOpen();
    const isTouch = Boolean(doc?.body?.classList?.contains?.('touch-active'));
    const snowAmt = Number(sky?.snowIntensity) || 0;
    const rainAmt = Number(sky?.rainIntensity) || 0;
    const timeId = sky?.timeId || 'day';
    const isSnowing = snowAmt > 0.18 || sky?.weatherId === 'snow';
    const isWinter = phenology?.currentId === 'winter' || sky?.phenologyId === 'winter';
    const isSnowOrWinter = isSnowing || isWinter;
    let text = '';
    if (!isFlightMode()) {
      if (active) {
        const spotName = nearby ? nearby.name : '桃源山水';
        let verse = '';
        if (isSnowOrWinter) {
          if (isSnowing) {
            verse = nearby?.winterLine || '朔雪落岭无声，松风过谷，万籁俱寂';
          } else if (timeId === 'night' || timeId === 'dusk') {
            verse = nearby?.winterNightLine || nearby?.winterLine || '寒星低垂，远岫覆雪，夜色静谧如水';
          } else if (timeId === 'day' && rainAmt < 0.12) {
            verse = nearby?.winterClearLine || nearby?.winterLine || '雪霁初晴，冰檐化水轻响，冬岭松风清远';
          } else {
            verse = nearby?.winterLine || '冬岭凝霜，松烟映雪，山谷清幽';
          }
        }
        const exitHint = isTouch ? ' · 轻推摇杆离开' : '　 C / 行走 / Esc 离开';
        text = verse
          ? `静听 · ${spotName} — ${verse}${exitHint}`
          : '静听 · ' + spotName + exitHint;
      } else if (!modal && nearby) {
        text = (isTouch ? '轻点驻足 · ' : 'C　驻足 · ') + nearby.name;
      }
    }
    if (notice) {
      notice.textContent = text;
      notice.classList?.toggle?.('show', Boolean(text));
    }
  }

  addSpots(spots);

  if (win?.addEventListener) {
    win.addEventListener('keydown', function (e) {
      if (
        e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
        isFlightMode() ||
        isModalBusy(doc) ||
        isControlTarget(e.target)
      ) {
        return;
      }
      if (active && ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        setActive(false);
        return;
      }
      if (e.code !== 'KeyC' || doc?.body?.classList?.contains?.('ui-hidden')) return;
      e.preventDefault();
      setActive(!active);
    });
  }

  if (exitBtn?.addEventListener) {
    exitBtn.addEventListener('click', function () {
      setActive(false);
      canvas?.focus?.();
    });
  }

  if (notice?.addEventListener) {
    notice.addEventListener('click', function (e) {
      if (isFlightMode() || isModalOpen()) return;
      if (!active && !nearby) return;
      e?.stopPropagation?.();
      setActive(!active);
    });
  }

  return {
    update,
    get active() { return active; },
    get spot() { return nearby; },
    addSpots,
    toggle: function () {
      if (isFlightMode() || isModalOpen()) return active;
      setActive(!active);
      return active;
    },
    exit: function () { setActive(false); }
  };
}
