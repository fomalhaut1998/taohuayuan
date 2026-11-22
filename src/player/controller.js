import { getBlockerGrid } from '../systems/spatial-grid.js';
import { isJumpableBlocker } from '../systems/barrier.js';

function isForward(code) {
  return code === 'KeyW' || code === 'ArrowUp';
}
function isBack(code) {
  return code === 'KeyS' || code === 'ArrowDown';
}
function isLeft(code) {
  return code === 'KeyA' || code === 'ArrowLeft';
}
function isRight(code) {
  return code === 'KeyD' || code === 'ArrowRight';
}
function isHeldMoveKey(code) {
  return isForward(code) || isBack(code) || isLeft(code) || isRight(code) || code === 'ShiftLeft' || code === 'ShiftRight';
}
function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

export function createPlayer(canvas, cfg, field, terrainCfg, hintEl, options) {
  const opts = options || {};
  const keys = new Set();
  const suspendedKeys = new Set();
  const touchMove = { x: 0, z: 0 };
  const blockers = opts.blockers || [];
  const cliff = opts.cliff || null;
  const viewCfg = cfg.view || {};
  const third = viewCfg.third || {};
  const viewKey = viewCfg.key || 'KeyV';
  const jumpSpeed = Number.isFinite(cfg.jumpSpeed) ? cfg.jumpSpeed : 6.2;
  const gravity = Number.isFinite(cfg.gravity) ? cfg.gravity : 15.8;
  const maxJumpableHeight = Number.isFinite(cfg.maxJumpableHeight) ? cfg.maxJumpableHeight : 1.32;
  const COYOTE_TIME = 0.10;
  const JUMP_BUFFER_TIME = 0.12;
  const SUPPORT_PAD = 0.36;
  let coyoteTimer = COYOTE_TIME;
  let jumpBufferTimer = 0;

  let slitFrame = null;
  if (cliff && cliff.slit) {
    if (Array.isArray(cliff.slit) && cliff.center && Number.isFinite(cliff.radius)) {
      const cx = cliff.center[0];
      const cz = cliff.center[1];
      const ang = Math.atan2(cliff.slit[1] - cz, cliff.slit[0] - cx);
      const ux = Math.cos(ang);
      const uz = Math.sin(ang);
      slitFrame = { x: cx + ux * cliff.radius, z: cz + uz * cliff.radius, ux, uz, tx: -uz, tz: ux };
    } else if (Number.isFinite(cliff.slit.x) && Number.isFinite(cliff.slit.z)) {
      const ang = cliff.slit.angle || 0;
      const ux = Math.cos(ang);
      const uz = Math.sin(ang);
      slitFrame = { x: cliff.slit.x, z: cliff.slit.z, ux, uz, tx: -uz, tz: ux };
    }
  }

  function caveFactorAt(px, pz) {
    if (!slitFrame) return 0;
    const dx = px - slitFrame.x;
    const dz = pz - slitFrame.z;
    const sAlong = dx * slitFrame.ux + dz * slitFrame.uz;
    if (sAlong < -27.5 || sAlong > 18.0) return 0;
    const lat = dx * slitFrame.tx + dz * slitFrame.tz;
    if (Math.abs(lat) > 4.5) return 0;
    const inS = Math.min(1, Math.max(0, Math.min((sAlong + 27.5) / 4.5, (18.0 - sAlong) / 4.0)));
    const inLat = Math.min(1, Math.max(0, (4.5 - Math.abs(lat)) / 1.8));
    const raw = inS * inLat;
    return raw * raw * (3 - 2 * raw);
  }

  const state = {
    yaw: cfg.spawn.yaw,
    pitch: cfg.spawn.pitch ?? 0,
    targetYaw: cfg.spawn.yaw,
    targetPitch: cfg.spawn.pitch ?? 0,
    x: cfg.spawn.x,
    z: cfg.spawn.z,
    y: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    airborne: false,
    onObstacle: false,
    jumpHeight: 0,
    jumpPhase: 0,
    landImpulse: 0,
    landImpact: 0,
    justJumped: false,
    justLanded: false,
    bob: 0,
    bobAmount: 0,
    speed: 0,
    touchMoveX: 0,
    touchMoveZ: 0,
    touchSprint: false,
    locked: false,
    view: 'third',
    eyeHeight: cfg.eyeHeight,
    camDist: 0,
    focus: false,
    focusTarget: null,
    shoulderK: 0,
    camYaw: 0,
    camPitch: 0,
    dt: 0.016
  };

  function groundSurfaceAt(x, z) {
    return typeof field.walkSurface === 'function' ? field.walkSurface(x, z) : field.sample(x, z);
  }

  state.y = Math.max(groundSurfaceAt(state.x, state.z), terrainCfg.waterLevel - cfg.wadeDepth);
  state.wading = false;
  state.camYaw = state.yaw;
  state.camPitch = state.pitch;

  function waterSurfaceAt(x, z, groundY) {
    const g = groundY !== undefined ? groundY : field.sample(x, z);
    const pond = terrainCfg && terrainCfg.pond;
    if (pond && Number.isFinite(pond.waterY)) {
      const r = (pond.radius || 13) + 0.6;
      const dx = x - pond.x;
      const dz = z - pond.z;
      if (dx * dx + dz * dz <= r * r && g < pond.waterY) {
        return pond.waterY;
      }
    }
    if (g < terrainCfg.waterLevel) return terrainCfg.waterLevel;
    return -Infinity;
  }

  function applyViewUI() {
    if (opts.viewNameEl) {
      opts.viewNameEl.textContent = state.view === 'third' ? '第三人称' : '第一人称';
    }
    if (opts.viewEl) {
      opts.viewEl.classList?.toggle?.('view--third', state.view === 'third');
    }
  }
  applyViewUI();

  function setView(next) {
    if (next !== 'first' && next !== 'third') return;
    state.view = next;
    if (next === 'third') {
      state.camYaw = state.yaw;
      state.camPitch = state.pitch;
    }
    applyViewUI();
  }

  function toggleView() {
    if (state.godFlight || document.body.classList.contains('map-open') || document.body.classList.contains('field-guide-open') || document.getElementById('journal')?.open) return;
    setView(state.view === 'first' ? 'third' : 'first');
  }

  function setFocus(target) {
    if (target && !target.noCameraLock && typeof target === 'object' && Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
      state.focus = true;
      state.focusTarget = { x: target.x, y: target.y, z: target.z };
    } else {
      state.focus = false;
      state.focusTarget = null;
    }
  }

  function onCanvasClick() {
    if (
      document.body?.classList?.contains?.('touch-active') ||
      window.matchMedia?.('(pointer: coarse)')?.matches
    ) return;
    if (state.locked || typeof canvas.requestPointerLock !== 'function') return;
    try {
      // Embedded/preview documents may reject pointer lock. Keyboard roaming
      // remains available, so a denied lock must not surface as an uncaught error.
      const pending = canvas.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (_) { /* Pointer lock is optional; do not interrupt scene input. */ }
  }

  function onViewClick(e) {
    if (e?.target?.closest?.('#view-fly')) return;
    e?.stopPropagation?.();
    toggleView();
  }

  function onPointerLockChange() {
    state.locked = document.pointerLockElement === canvas;
    if (hintEl) hintEl.classList.toggle('hidden', state.locked);
    if (!state.locked) keys.clear();
  }

  function onMouseMove(e) {
    if (!state.locked || state.godFlight) return;
    state.targetYaw -= e.movementX * cfg.lookSensitivity;
    state.targetPitch -= e.movementY * cfg.lookSensitivity;
    if (state.targetPitch > cfg.maxPitch) state.targetPitch = cfg.maxPitch;
    if (state.targetPitch < -cfg.maxPitch) state.targetPitch = -cfg.maxPitch;
  }

  function isOverlayBlocked() {
    const doc = typeof document !== 'undefined' ? document : null;
    const cl = doc?.body?.classList;
    if (cl) {
      if (
        cl.contains('god-flight') ||
        cl.contains('map-open') ||
        cl.contains('field-guide-open') ||
        cl.contains('scroll-studio-open') ||
        cl.contains('traveler-guide-open') ||
        cl.contains('quest-open') ||
        cl.contains('cruise-active') ||
        cl.contains('ink-epilogue-open')
      ) return true;
    }
    if (doc?.getElementById?.('journal')?.open) return true;
    const veil = doc?.getElementById?.('veil');
    if (veil && !veil.hidden && !veil.classList?.contains?.('curtain-gone') && !cl?.contains?.('curtain-open')) {
      return true;
    }
    return false;
  }

  function canTriggerJump() {
    if (state.godFlight || state.aboardSkiff || state.still || state.seated || (state.sitAmount || 0) > 0.05) {
      return false;
    }
    return !isOverlayBlocked();
  }

  function jump() {
    if (!canTriggerJump()) return false;
    jumpBufferTimer = JUMP_BUFFER_TIME;
    return true;
  }

  function onKeyDown(e) {
    // Text entry, controls and browser shortcuts must retain their native keys.
    const target = e.target;
    const inControl = target && (target.isContentEditable ||
      (typeof target.closest === 'function' && target.closest('input, textarea, select, button, a[href], [contenteditable]')));
    if (e.ctrlKey || e.metaKey || e.altKey || inControl || state.godFlight || document.body?.classList?.contains?.('god-flight') || document.body?.classList?.contains?.('map-open') || document.body?.classList?.contains?.('quest-open') || document.getElementById?.('journal')?.open) return;
    if (suspendedKeys.has(e.code)) return;
    if (e.code === viewKey && !e.repeat) {
      e.preventDefault();
      toggleView();
    }
    if (isHeldMoveKey(e.code)) keys.add(e.code);
    if (e.code === 'Space') {
      if (!e.repeat && canTriggerJump()) {
        e.preventDefault();
        jumpBufferTimer = JUMP_BUFFER_TIME;
      } else if (state.locked) {
        e.preventDefault();
      }
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    suspendedKeys.delete(e.code);
  }

  function clearInput() {
    keys.forEach(function (key) { suspendedKeys.add(key); });
    keys.clear();
    jumpBufferTimer = 0;
    state.vx = 0; state.vz = 0; state.speed = 0;
  }

  function onBlur() {
    keys.clear();
    suspendedKeys.clear();
  }

  canvas.addEventListener('click', onCanvasClick);
  opts.viewEl?.addEventListener?.('click', onViewClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  function checkObbPad(b, x, z, pad) {
    const dx = x - b.x;
    const dz = z - b.z;
    const reach = b.hw + b.hd + pad;
    if (dx * dx + dz * dz > reach * reach) return false;
    const ca = Math.cos(b.rot);
    const sa = Math.sin(b.rot);
    const lx = dx * ca - dz * sa;
    const lz = dx * sa + dz * ca;
    return Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad;
  }

  function isBlocked(x, z, camY) {
    const pad = third.pad ?? 0.28;
    const hasY = Number.isFinite(camY);
    const grid = blockers.length >= 24 ? getBlockerGrid(blockers, 8, Math.max(2.0, pad)) : null;
    if (grid) {
      const count = grid.collectPoint(x, z, pad);
      if (count >= 0) {
        const buf = grid.buf;
        for (let k = 0; k < count; k++) {
          const b = blockers[buf[k]];
          if (hasY && Number.isFinite(b.maxY) && camY > b.maxY + 0.18 && isJumpableBlocker(b)) continue;
          if (checkObbPad(b, x, z, pad)) return true;
        }
        return false;
      }
    }
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (hasY && Number.isFinite(b.maxY) && camY > b.maxY + 0.18 && isJumpableBlocker(b)) continue;
      if (checkObbPad(b, x, z, pad)) return true;
    }
    return false;
  }

  function supportObstacleTopAt(x, z, prevY, terrainFloor) {
    if (!state.airborne && !state.onObstacle) return -Infinity;
    let bestTop = -Infinity;
    const grid = blockers.length >= 24 ? getBlockerGrid(blockers, 8, Math.max(2.0, SUPPORT_PAD)) : null;
    if (grid) {
      const count = grid.collectPoint(x, z, SUPPORT_PAD);
      if (count >= 0) {
        const buf = grid.buf;
        for (let k = 0; k < count; k++) {
          const b = blockers[buf[k]];
          if (!isJumpableBlocker(b)) continue;
          if (b.maxY - terrainFloor > maxJumpableHeight) continue;
          if (prevY < b.maxY - 0.20) continue;
          if (checkObbPad(b, x, z, SUPPORT_PAD) && b.maxY > bestTop) {
            bestTop = b.maxY;
          }
        }
        return bestTop;
      }
    }
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (!isJumpableBlocker(b)) continue;
      if (b.maxY - terrainFloor > maxJumpableHeight) continue;
      if (prevY < b.maxY - 0.20) continue;
      if (checkObbPad(b, x, z, SUPPORT_PAD) && b.maxY > bestTop) {
        bestTop = b.maxY;
      }
    }
    return bestTop;
  }

  function placeFirst(camera) {
    const eyeWaterY = waterSurfaceAt(state.x, state.z);
    const minEyeY = Number.isFinite(eyeWaterY) ? eyeWaterY + 0.34 : -Infinity;
    const landDip = state.landImpulse > 0 ? Math.sin(state.landImpulse * Math.PI) * 0.052 * (state.landImpact || 0.7) : 0;
    camera.position.set(state.x, Math.max(state.y + cfg.eyeHeight + state.bobAmount - landDip, minEyeY), state.z);
    camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    state.camDist = 0;
  }

  function placeThird(camera) {
    const caveK = state.aboardSkiff ? 0 : caveFactorAt(state.x, state.z);
    const baseMaxDist = third.distance ?? 4.3;
    const maxDist = baseMaxDist * (1 - 0.48 * caveK);
    const camY0 = state.y + (third.height ?? 2.18) - 0.60 * caveK;
    const minGround = third.minGround ?? 0.34;
    const steps = Math.max(24, third.steps ?? 24);
    // 平时轻微过肩；近观时再让开一点，入洞时自动回中紧随背影避免擦撞岩壁
    const shoulder = ((third.shoulder ?? 0.55) + (third.focusShoulder ?? 0) * state.shoulderK) * (1 - caveK);
    const sy = Math.sin(state.yaw);
    const cyw = Math.cos(state.yaw);
    let hit = maxDist;
    let blocked = false;

    if (!state.aboardSkiff) {
      for (let i = 1; i <= steps; i++) {
        const d = (maxDist * i) / steps;
        // Match the shoulder offset used by the eventual camera position.
        const sampleShoulder = d < (third.shoulderMinDistance ?? 1.2) ? 0 : shoulder;
        const sx = state.x + sy * d + cyw * sampleShoulder;
        const sz = state.z + cyw * d - sy * sampleShoulder;
        const sg = field.sample(sx, sz);
        const sw = waterSurfaceAt(sx, sz, sg);
        const sSurf = Number.isFinite(sw) ? Math.max(sg, sw) : sg;
        if (isBlocked(sx, sz, camY0) || sSurf + minGround > camY0) {
          hit = (maxDist * (i - 1)) / steps;
          blocked = true;
          break;
        }
      }
    }

    // 撞到墙/坡就把相机收回来；收得太近时主循环会藏掉自机角色，避免糊在镜头上
    // A hard minimum can place the camera beyond a very nearby wall.
    const dist = blocked ? Math.max(0, hit - (third.pad ?? 0.28)) : maxDist;
    // 过肩偏移：让自机角色站到画面一侧，不挡住正在近观的人物
    const shoulderNow = dist < (third.shoulderMinDistance ?? 1.2) ? 0 : shoulder;
    let cx = state.x + sy * dist + cyw * shoulderNow;
    let cz = state.z + cyw * dist - sy * shoulderNow;
    if (shoulderNow > 0 && isBlocked(cx, cz, camY0)) {
      cx -= cyw * shoulderNow;
      cz += sy * shoulderNow;
    }
    let cy = camY0;
    const ground = field.sample(cx, cz);
    const waterY = waterSurfaceAt(cx, cz, ground);
    const minSurface = Number.isFinite(waterY) ? Math.max(ground, waterY) : ground;
    if (cy < minSurface + minGround) cy = minSurface + minGround;

    // 第三人称的视线从相机出发；近观时仅对正前方目标温和框取，绝不反向锁死身后船只或物件
    let aimYaw = state.yaw;
    let aimPitch = state.pitch;
    const ft = state.focusTarget;
    let activeFt = false;
    if (ft && caveK < 0.35) {
      const fwdX = -Math.sin(state.yaw);
      const fwdZ = -Math.cos(state.yaw);
      const pdx = ft.x - state.x;
      const pdz = ft.z - state.z;
      const pLen = Math.hypot(pdx, pdz) || 1;
      const fwdDot = (pdx * fwdX + pdz * fwdZ) / pLen;
      if (fwdDot > 0.35) {
        const tx = ft.x - cx;
        const ty = ft.y - cy;
        const tz = ft.z - cz;
        const h = Math.hypot(tx, tz) || 1;
        const rawYaw = Math.atan2(-tx, -tz);
        let dYaw = rawYaw - state.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        aimYaw = state.yaw + Math.max(-0.42, Math.min(0.42, dYaw));
        aimPitch = Math.atan2(ty, h);
        if (aimPitch > cfg.maxPitch) aimPitch = cfg.maxPitch;
        if (aimPitch < -cfg.maxPitch) aimPitch = -cfg.maxPitch;
        activeFt = true;
      }
    }
    const lookK = 1 - Math.exp(-(activeFt ? 8 : 14) * (state.dt || 0.016));
    state.camYaw = angleLerp(state.camYaw, aimYaw, lookK);
    state.camPitch += (aimPitch - state.camPitch) * lookK;

    camera.position.set(cx, cy, cz);
    camera.rotation.set(state.camPitch, state.camYaw, 0, 'YXZ');
    state.camDist = dist;
  }

  function placeCamera(camera) {
    if (state.view === 'third') placeThird(camera);
    else placeFirst(camera);
  }

  function update(dt, camera) {
    state.dt = dt;
    state.justJumped = false;
    state.justLanded = false;
    if (jumpBufferTimer > 0) jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);

    const lookK = 1 - Math.exp(-cfg.lookSmoothing * dt);
    state.yaw += (state.targetYaw - state.yaw) * lookK;
    state.pitch += (state.targetPitch - state.pitch) * lookK;

    const shoulderTarget = state.focus ? 1 : 0;
    state.shoulderK += (shoulderTarget - state.shoulderK) * (1 - Math.exp(-6 * dt));

    if (state.aboardSkiff) {
      state.bob = 0;
      state.bobAmount = 0;
      state.wading = false;
      state.vy = 0;
      state.grounded = true;
      state.airborne = false;
      state.onObstacle = false;
      state.jumpHeight = 0;
      state.jumpPhase = 0;
      state.landImpulse = 0;
      jumpBufferTimer = 0;
      coyoteTimer = COYOTE_TIME;
      placeCamera(camera);
      return;
    }

    if (state.godFlight) {
      state.bob = 0;
      state.bobAmount = 0;
      state.wading = false;
      state.vy = 0;
      state.grounded = true;
      state.airborne = false;
      state.onObstacle = false;
      state.jumpHeight = 0;
      state.jumpPhase = 0;
      state.landImpulse = 0;
      jumpBufferTimer = 0;
      coyoteTimer = COYOTE_TIME;
      placeCamera(camera);
      return;
    }

    let ix = touchMove.x;
    let iz = touchMove.z;
    keys.forEach(function (code) {
      if (isForward(code)) iz += 1;
      else if (isBack(code)) iz -= 1;
      else if (isRight(code)) ix += 1;
      else if (isLeft(code)) ix -= 1;
    });

    if (state.still || state.seated) { ix = 0; iz = 0; state.vx = 0; state.vz = 0; }
    const sinY = Math.sin(state.yaw);
    const cosY = Math.cos(state.yaw);
    const fx = -sinY;
    const fz = -cosY;
    const rx = cosY;
    const rz = -sinY;

    let wx = fx * iz + rx * ix;
    let wz = fz * iz + rz * ix;
    const wl = Math.hypot(wx, wz);
    const rawMag = Math.hypot(ix, iz);
    const moveScale = rawMag > 1 ? 1 : rawMag;

    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || Boolean(state.touchSprint);
    const preGround = field.sample(state.x, state.z);
    const preWaterY = waterSurfaceAt(state.x, state.z, preGround);
    const wadeSubmerge = Number.isFinite(preWaterY) ? Math.max(0, preWaterY - preGround) : 0;
    const wadeDrag = (!state.airborne && wadeSubmerge > 0.12)
      ? 1 - 0.26 * Math.min(1, (wadeSubmerge - 0.12) / Math.max(0.25, cfg.wadeDepth))
      : 1;
    const speed = (running ? cfg.runSpeed : cfg.walkSpeed) * wadeDrag;

    if (wl > 0.0001) {
      wx = (wx / wl) * speed * moveScale;
      wz = (wz / wl) * speed * moveScale;
    } else {
      wx = 0;
      wz = 0;
    }

    const moveDamp = state.airborne ? cfg.moveDamping * 0.72 : cfg.moveDamping;
    const moveK = 1 - Math.exp(-moveDamp * dt);
    state.vx += (wx - state.vx) * moveK;
    state.vz += (wz - state.vz) * moveK;

    const prevX = state.x;
    const prevY = state.y;
    const prevZ = state.z;
    state.x += state.vx * dt;
    state.z += state.vz * dt;

    let inBasin = false;
    if (cliff && cliff.center && Number.isFinite(cliff.radius)) {
      const cx = cliff.center[0];
      const cz = cliff.center[1];
      const R = cliff.radius;
      const innerR = R - 6.5;
      const outerR = R + 6.5;
      const arcFrom = Number.isFinite(cliff.arcFrom) ? cliff.arcFrom : 0.55;
      const arcTo = Number.isFinite(cliff.arcTo) ? cliff.arcTo : 2.59;
      const flankZ = cz + Math.sin(arcFrom) * R;
      const flankZInner = cz + Math.sin(arcFrom) * innerR - 2.0;
      const flankZOuter = flankZ + 6.5;
      const maxInteriorR = Number.isFinite(opts.maxInteriorRadius)
        ? opts.maxInteriorRadius
        : (Number.isFinite(cfg.interiorBoundsRadius) ? cfg.interiorBoundsRadius : 196);
      const prevR = Math.hypot(prevX - cx, prevZ - cz);
      const prevInInterior = prevR < R || prevZ < flankZ;
      const dx = state.x - cx;
      const dz = state.z - cz;
      const r = Math.hypot(dx, dz) || 1e-6;
      const ang = Math.atan2(dz, dx);
      const rimSealed = ang < arcFrom + 0.06 || ang > arcTo - 0.06;
      if (prevInInterior) {
        inBasin = true;
        if (rimSealed) {
          if (r > maxInteriorR) {
            const s = maxInteriorR / r;
            state.x = cx + dx * s;
            state.z = cz + dz * s;
            state.vx *= 0.25;
            state.vz *= 0.25;
          }
          if (r > innerR && state.z > flankZInner) {
            state.z = flankZInner;
            state.vz = Math.min(0, state.vz * 0.25);
          }
        }
      } else if (rimSealed) {
        if (r < outerR) {
          const s = outerR / r;
          state.x = cx + dx * s;
          state.z = cz + dz * s;
          state.vx *= 0.25;
          state.vz *= 0.25;
        } else if (state.z < flankZOuter) {
          state.z = flankZOuter;
          state.vz = Math.max(0, state.vz * 0.25);
        }
      }
    }

    if (!inBasin) {
      const dist = Math.hypot(state.x, state.z);
      if (dist > cfg.boundsRadius) {
        const k = cfg.boundsRadius / dist;
        state.x *= k;
        state.z *= k;
        state.vx *= 0.25;
        state.vz *= 0.25;
      }
    }

    if (jumpBufferTimer > 0 && (state.grounded || coyoteTimer > 0) && canTriggerJump()) {
      const wadeJumpScale = wadeSubmerge > 0.12
        ? 1 - 0.18 * Math.min(1, (wadeSubmerge - 0.12) / Math.max(0.25, cfg.wadeDepth))
        : 1;
      state.vy = jumpSpeed * wadeJumpScale;
      state.grounded = false;
      state.airborne = true;
      state.onObstacle = false;
      state.justJumped = true;
      jumpBufferTimer = 0;
      coyoteTimer = 0;
    }

    const ground = groundSurfaceAt(state.x, state.z);
    const localWaterY = waterSurfaceAt(state.x, state.z, ground);
    const localMinY = Number.isFinite(localWaterY) ? localWaterY - cfg.wadeDepth : -Infinity;
    const terrainFloor = Math.max(ground, terrainCfg.waterLevel - cfg.wadeDepth, localMinY);
    const obsTop = supportObstacleTopAt(state.x, state.z, prevY, terrainFloor);
    const floor = Math.max(terrainFloor, obsTop);
    const onObsFloor = obsTop > terrainFloor + 0.02;

    if (state.airborne) {
      if (coyoteTimer > 0) coyoteTimer = Math.max(0, coyoteTimer - dt);
      state.vy -= gravity * dt;
      state.y += state.vy * dt;
      // 洞穴窄段拱顶净空保护，避免起跳穿顶
      const caveK = caveFactorAt(state.x, state.z);
      if (caveK > 0.1 && state.vy > 0) {
        const caveHeadroom = Math.max(0.45, 2.34 - cfg.eyeHeight);
        const maxCaveY = ground + caveHeadroom + (1 - caveK) * 1.4;
        if (state.y > maxCaveY) {
          state.y = maxCaveY;
          state.vy = 0;
        }
      }
      if (state.y <= floor && state.vy <= 0) {
        const impact = Math.min(1, Math.abs(state.vy) / Math.max(1, jumpSpeed));
        state.y = floor;
        state.vy = 0;
        state.grounded = true;
        state.airborne = false;
        state.onObstacle = onObsFloor;
        coyoteTimer = COYOTE_TIME;
        if (impact > 0.15) {
          state.justLanded = true;
          state.landImpact = impact;
          state.landImpulse = Math.max(state.landImpulse, Math.min(1, impact * 0.95));
        }
      }
    } else {
      if (state.onObstacle && !onObsFloor && state.y > floor + 0.16) {
        // 从低矮障碍物边缘走下时顺滑下落，允许短时土狼跳
        state.grounded = false;
        state.airborne = true;
        state.onObstacle = false;
        state.vy = 0;
        coyoteTimer = COYOTE_TIME;
      } else {
        const groundK = 1 - Math.exp(-18 * dt);
        // Never let the feet lag beneath a rising surface; retain smooth descent.
        state.y = Math.max(floor, state.y + (floor - state.y) * groundK);
        state.vy = 0;
        state.grounded = true;
        state.onObstacle = onObsFloor;
        coyoteTimer = COYOTE_TIME;
      }
    }

    state.landImpulse = Math.max(0, state.landImpulse - dt * 5.2);
    state.jumpHeight = Math.max(0, state.y - terrainFloor);
    const phaseK = 1 - Math.exp(-14 * dt);
    state.jumpPhase += ((state.airborne ? 1 : 0) - state.jumpPhase) * phaseK;
    state.wading = !state.airborne && Number.isFinite(localWaterY) && (localWaterY - ground) > 0.12 && state.y < localWaterY - 0.08;

    const vel = Math.hypot(state.vx, state.vz);
    state.speed = vel;
    if (!state.airborne) state.bob += dt * vel * 1.9;
    state.bobAmount = Math.sin(state.bob) * 0.028 * Math.min(1, vel / cfg.walkSpeed) * (1 - state.jumpPhase);

    placeCamera(camera);
  }

  function syncCamera(camera) {
    placeCamera(camera);
  }

  function dispose() {
    canvas.removeEventListener('click', onCanvasClick);
    opts.viewEl?.removeEventListener?.('click', onViewClick);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
  }

  function setTouchMove(x, z) {
    touchMove.x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    touchMove.z = Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0;
    state.touchMoveX = touchMove.x;
    state.touchMoveZ = touchMove.z;
  }

  function setTouchSprint(on) {
    state.touchSprint = Boolean(on);
  }

  function addTouchLook(dx, dy) {
    if (state.godFlight) return;
    if (Number.isFinite(dx)) state.targetYaw -= dx * cfg.lookSensitivity * 1.45;
    if (Number.isFinite(dy)) {
      state.targetPitch -= dy * cfg.lookSensitivity * 1.35;
      if (state.targetPitch > cfg.maxPitch) state.targetPitch = cfg.maxPitch;
      if (state.targetPitch < -cfg.maxPitch) state.targetPitch = -cfg.maxPitch;
    }
  }

  return {
    update: update,
    syncCamera: syncCamera,
    setView: setView,
    toggleView: toggleView,
    setFocus: setFocus,
    jump: jump,
    setTouchMove: setTouchMove,
    setTouchSprint: setTouchSprint,
    addTouchLook: addTouchLook,
    clearInput: function () {
      touchMove.x = 0;
      touchMove.z = 0;
      state.touchMoveX = 0;
      state.touchMoveZ = 0;
      state.touchSprint = false;
      clearInput();
    },
    state: state,
    dispose: dispose
  };
}
