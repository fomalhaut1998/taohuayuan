import * as THREE from 'three';
import { isModalBusy, isControlTarget } from './modal-state.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 自由飞行上帝视角（P 或 B 键切换）：
 * 支持任意高度与位置全向飞览（WASD 沿镜头方向飞行、Space 爬升、Q/Ctrl 下降、
 * Shift 疾飞、滚轮调速、鼠标锁定或拖拽环视），并解除山体出入口视野剔除限制。
 */
export function createGodFlight({
  scene,
  camera,
  player,
  avatar,
  canvas,
  world,
  field,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  interiorGroups = [],
  exteriorGroups = []
} = {}) {
  let active = false;
  let yaw = 0;
  let pitch = -0.35;
  let x = 0;
  let y = 32;
  let z = -120;
  let speed = 24;
  let dragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let touchX = 0;
  let touchZ = 0;
  let touchVert = 0;
  let touchBoost = false;
  let disposed = false;
  const keys = Object.create(null);

  function clearTouchInput() {
    touchX = 0;
    touchZ = 0;
    touchVert = 0;
    touchBoost = false;
  }

  const waterMin = (world?.terrain?.waterLevel ?? -1.0) + 0.65;
  const waterBase = world?.terrain?.waterLevel ?? -1.0;
  const viewEl = doc?.getElementById?.('view') || null;
  const viewNameEl = doc?.getElementById?.('view-name') || null;
  const hintEl = doc?.getElementById?.('hint') || null;
  if (hintEl?.dataset && !hintEl.dataset.walkHintHtml && !player?.state?.aboardSkiff && hintEl.innerHTML) {
    hintEl.dataset.walkHintHtml = hintEl.innerHTML;
  }
  const defaultHintHtml = hintEl?.dataset?.walkHintHtml || hintEl?.innerHTML || hintEl?.textContent || '';
  const FLY_HINT = '上帝飞览 · WASD 前后左右 · 空格升 · Q/Ctrl 降 · Shift 加速 · 滚轮调速 · 拖拽/指针转动视角 · P/B 返回';
  const FLY_HINT_HTML = [
    '上帝飞览',
    'WASD 前后左右',
    '空格升',
    'Q/Ctrl 降',
    'Shift 加速',
    '滚轮调速',
    '拖拽/指针转动视角',
    'P/B 返回'
  ].map(item => `<span class="hint__group">${item}</span>`).join('');
  const SKIFF_HINT_HTML = [
    'WASD 撑篙泛舟',
    'X 收篙随波',
    'E 舍船登岸',
    'V 切换视角'
  ].map(item => `<span class="hint__group">${item}</span>`).join('');

  let altEl = null;
  let lastAltText = '';
  let flyBtn = null;
  if (viewEl && doc?.createElement) {
    altEl = doc.createElement('span');
    altEl.id = 'view-alt';
    altEl.className = 'view__alt';
    altEl.style.cssText = 'display:none;';
    altEl.style.display = 'none';
    viewEl.appendChild(altEl);

    flyBtn = doc.createElement('button');
    flyBtn.id = 'view-fly';
    flyBtn.className = 'view__fly';
    flyBtn.type = 'button';
    flyBtn.title = '切换自由飞行上帝视角 (P / B)';
    flyBtn.textContent = '飞览 P';
    flyBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggle();
      flyBtn.blur();
    });
    viewEl.appendChild(flyBtn);
  }

  function computeAltitudeMetrics() {
    const rawGround = field?.sample ? field.sample(x, z) : waterBase;
    const terrainFloor = Number.isFinite(rawGround) ? Math.max(waterBase, rawGround) : waterBase;
    const altitude = y - waterBase;
    const aboveGround = Math.max(0, y - terrainFloor);
    return { altitude, aboveGround };
  }

  function syncAltitudeUi() {
    if (!altEl) return;
    if (!active) {
      if (altEl.style.display !== 'none') altEl.style.display = 'none';
      return;
    }
    if (altEl.style.display !== 'inline-block') altEl.style.display = 'inline-block';
    const { altitude, aboveGround } = computeAltitudeMetrics();
    const nextText = '海拔 ' + altitude.toFixed(1) + 'm · 离地 ' + aboveGround.toFixed(1) + 'm';
    if (nextText !== lastAltText) {
      lastAltText = nextText;
      altEl.textContent = nextText;
    }
  }

  function syncHudUi() {
    if (doc?.body?.classList) {
      if (active) doc.body.classList.add?.('god-flight');
      else doc.body.classList.remove?.('god-flight');
    }
    if (player?.state) {
      player.state.godFlight = active;
    }
    if (flyBtn) {
      flyBtn.setAttribute?.('aria-pressed', String(active));
      flyBtn.classList?.toggle?.('is-active', active);
      flyBtn.textContent = active ? '步行 P' : '飞览 P';
    }
    viewEl?.classList?.toggle?.('view--flight', active);
    if (viewNameEl) {
      if (active) viewNameEl.textContent = '上帝飞览';
      else if (player?.state?.view) viewNameEl.textContent = player.state.view === 'third' ? '第三人称' : '第一人称';
    }
    if (hintEl) {
      const isDomHint = typeof hintEl.querySelectorAll === 'function' && typeof hintEl.innerHTML === 'string';
      const walkHtml = hintEl.dataset?.walkHintHtml || defaultHintHtml;
      if (active) {
        if (isDomHint) hintEl.innerHTML = FLY_HINT_HTML;
        else hintEl.textContent = FLY_HINT;
      } else if (player?.state?.aboardSkiff) {
        if (isDomHint) hintEl.innerHTML = SKIFF_HINT_HTML;
        else hintEl.textContent = 'WASD 撑篙泛舟 · E 舍船登岸 · V 切换视角';
      } else if (walkHtml) {
        if (isDomHint) hintEl.innerHTML = walkHtml;
        else hintEl.textContent = walkHtml;
      }
    }
    syncAltitudeUi();
  }

  function enforceVisibility(visible = true) {
    if (!visible) return;
    for (const g of interiorGroups) if (g) g.visible = true;
    for (const g of exteriorGroups) if (g) g.visible = true;
  }

  const prevOnBeforeRender = scene?.onBeforeRender;
  function beforeRenderHook(...args) {
    if (typeof prevOnBeforeRender === 'function') prevOnBeforeRender.apply(this, args);
    if (active) enforceVisibility(true);
  }
  if (scene) scene.onBeforeRender = beforeRenderHook;

  function applyCamera() {
    if (!camera) return;
    camera.position.set(x, y, z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  function setPose(px, py, pz, pyaw = yaw, ppitch = pitch) {
    x = clamp(Number.isFinite(px) ? px : x, -380, 380);
    const groundY = field?.sample ? field.sample(x, z) + 0.5 : waterMin;
    y = clamp(Number.isFinite(py) ? py : y, Math.max(waterMin, groundY - 0.15), 320);
    z = clamp(Number.isFinite(pz) ? pz : z, -380, 380);
    yaw = Number.isFinite(pyaw) ? pyaw : yaw;
    pitch = clamp(Number.isFinite(ppitch) ? ppitch : pitch, -1.52, 1.52);
    if (active) {
      applyCamera();
      syncAltitudeUi();
    }
  }

  function enter(pose = null) {
    if (disposed || active) return false;
    active = true;
    if (player?.state) {
      player.state.godFlight = true;
      if (Number.isFinite(player.state.yaw)) player.state.targetYaw = player.state.yaw;
      if (Number.isFinite(player.state.pitch)) player.state.targetPitch = player.state.pitch;
    }
    for (const k of Object.keys(keys)) keys[k] = false;
    clearTouchInput();
    player?.clearInput?.();
    if (pose && Number.isFinite(pose.x)) {
      setPose(pose.x, pose.y, pose.z, pose.yaw ?? 0, pose.pitch ?? -0.35);
    } else if (camera) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      const baseG = field?.sample ? field.sample(cx, cz) : 0;
      const liftY = Math.max(camera.position.y + 10, baseG + 14);
      const stYaw = camera.rotation?.y ?? player?.state?.yaw ?? 0;
      const stPitch = clamp((camera.rotation?.x ?? 0) - 0.18, -1.35, 0.35);
      setPose(cx, liftY, cz, stYaw, stPitch);
    }
    if (avatar?.group) avatar.group.visible = true;
    enforceVisibility(true);
    applyCamera();
    syncHudUi();
    return true;
  }

  function exit() {
    if (!active) return false;
    active = false;
    if (player?.state) player.state.godFlight = false;
    dragging = false;
    for (const k of Object.keys(keys)) keys[k] = false;
    clearTouchInput();
    player?.clearInput?.();
    syncHudUi();
    return true;
  }

  function toggle() {
    return active ? exit() : enter();
  }

  function modalBlocked() {
    return isModalBusy(doc, { includeCruise: true });
  }

  function onKeyDown(e) {
    if (disposed) return;
    if (e.code === 'KeyP' || e.code === 'KeyB') {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || modalBlocked() || isControlTarget(e.target)) return;
      e.preventDefault();
      toggle();
      return;
    }
    if (!active) return;
    keys[e.code] = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onBlur() {
    dragging = false;
    clearTouchInput();
    for (const k of Object.keys(keys)) keys[k] = false;
  }

  function onMouseDown(e) {
    if (!active || e.target !== canvas || e.button !== 0) return;
    dragging = true;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
  }

  function onMouseUp() {
    dragging = false;
  }

  function onMouseMove(e) {
    if (!active) return;
    const sens = world?.player?.lookSensitivity ?? 0.0022;
    if (doc && doc.pointerLockElement === canvas) {
      yaw -= e.movementX * sens;
      pitch = clamp(pitch - e.movementY * sens, -1.52, 1.52);
    } else if (dragging) {
      const dx = e.clientX - lastDragX;
      const dy = e.clientY - lastDragY;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
      yaw -= dx * sens * 1.4;
      pitch = clamp(pitch - dy * sens * 1.4, -1.52, 1.52);
    }
  }

  function onWheel(e) {
    if (!active || modalBlocked()) return;
    speed = clamp(speed * (e.deltaY < 0 ? 1.15 : 0.87), 8, 95);
  }

  win?.addEventListener?.('keydown', onKeyDown);
  win?.addEventListener?.('keyup', onKeyUp);
  win?.addEventListener?.('blur', onBlur);
  win?.addEventListener?.('mouseup', onMouseUp);
  win?.addEventListener?.('mousemove', onMouseMove);
  canvas?.addEventListener?.('mousedown', onMouseDown);
  win?.addEventListener?.('wheel', onWheel, { passive: true });

  function update(dt) {
    if (disposed || !active) return;
    const step = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.08);
    player?.clearInput?.();

    const keyFwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const keySide = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const keyVert = (keys.Space ? 1 : 0) - (keys.KeyQ || keys.ControlLeft || keys.ControlRight ? 1 : 0);
    const fwd = clamp(keyFwd + touchZ, -1, 1);
    const side = clamp(keySide + touchX, -1, 1);
    const vert = clamp(keyVert + touchVert, -1, 1);
    const boost = (keys.ShiftLeft || keys.ShiftRight || touchBoost) ? 2.6 : 1.0;

    if (Math.abs(fwd) > 1e-3 || Math.abs(side) > 1e-3 || Math.abs(vert) > 1e-3) {
      const sp = speed * boost * step;
      const cp = Math.cos(pitch);
      const spitch = Math.sin(pitch);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const fx = -sy * cp;
      const fy = spitch;
      const fz = -cy * cp;
      const rx = cy;
      const rz = -sy;

      const nextX = x + (fx * fwd + rx * side) * sp;
      const nextZ = z + (fz * fwd + rz * side) * sp;
      const nextY = y + (fy * fwd + vert) * sp;
      setPose(nextX, nextY, nextZ, yaw, pitch);
    } else {
      applyCamera();
    }
    syncAltitudeUi();
    enforceVisibility(true);
  }

  function getState() {
    const { altitude, aboveGround } = computeAltitudeMetrics();
    return { active, x, y, z, yaw, pitch, speed, altitude, aboveGround, disposed };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    exit();
    clearTouchInput();
    if (player?.state) player.state.godFlight = false;
    doc?.body?.classList?.remove?.('god-flight');
    viewEl?.classList?.remove?.('view--flight');
    if (scene && scene.onBeforeRender === beforeRenderHook) {
      scene.onBeforeRender = prevOnBeforeRender || (() => {});
    }
    altEl?.remove?.();
    flyBtn?.remove?.();
    win?.removeEventListener?.('keydown', onKeyDown);
    win?.removeEventListener?.('keyup', onKeyUp);
    win?.removeEventListener?.('blur', onBlur);
    win?.removeEventListener?.('mouseup', onMouseUp);
    win?.removeEventListener?.('mousemove', onMouseMove);
    canvas?.removeEventListener?.('mousedown', onMouseDown);
    win?.removeEventListener?.('wheel', onWheel);
  }

  function setTouchMove(mx, mz) {
    touchX = Number.isFinite(mx) ? clamp(mx, -1, 1) : 0;
    touchZ = Number.isFinite(mz) ? clamp(mz, -1, 1) : 0;
  }

  function setTouchVertical(v) {
    touchVert = Number.isFinite(v) ? clamp(v, -1, 1) : 0;
  }

  function setTouchBoost(on) {
    touchBoost = Boolean(on);
  }

  function addTouchLook(dx, dy) {
    if (!active || disposed) return;
    const sens = world?.player?.lookSensitivity ?? 0.0022;
    if (Number.isFinite(dx)) yaw -= dx * sens * 1.45;
    if (Number.isFinite(dy)) pitch = clamp(pitch - dy * sens * 1.35, -1.52, 1.52);
  }

  return {
    get active() { return active; },
    enter,
    exit,
    toggle,
    setPose,
    setTouchMove,
    setTouchVertical,
    setTouchBoost,
    addTouchLook,
    enforceVisibility,
    update,
    getState,
    dispose
  };
}
