import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SHICHEN = [
  { start: 23, name: '子时', label: '子' },
  { start: 1, name: '丑时', label: '丑' },
  { start: 3, name: '寅时', label: '寅' },
  { start: 5, name: '卯时', label: '卯' },
  { start: 7, name: '辰时', label: '辰' },
  { start: 9, name: '巳时', label: '巳' },
  { start: 11, name: '午时', label: '午' },
  { start: 13, name: '未时', label: '未' },
  { start: 15, name: '申时', label: '申' },
  { start: 17, name: '酉时', label: '酉' },
  { start: 19, name: '戌时', label: '戌' },
  { start: 21, name: '亥时', label: '亥' }
];

const PHASE_NAMES = {
  dawn: '晨',
  day: '昼',
  dusk: '暮',
  night: '夜'
};

const PHASE_ANCHOR_HOURS = {
  dawn: 5.75,  // 卯正
  day: 9.5,    // 巳初
  dusk: 17.75, // 酉正
  night: 21.5  // 亥初
};

export function hourToPhase(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

export function formatShichen(hour) {
  const h = ((hour % 24) + 24) % 24;
  const shifted = (h + 1) % 24;
  const idx = Math.floor(shifted / 2) % 12;
  const within = shifted - idx * 2; // 0..2h within shichen
  const half = within < 1 ? '初' : '正';
  const entry = SHICHEN[idx];
  return {
    name: entry.name,
    short: entry.label + half,
    full: entry.name + half,
    half
  };
}

// 《桃花源记》“晋太元中”代表纪年（东晋孝武帝太元十一年 = 公元 386 年），按四时物候锚定月日并随昼夜推进。
const MODERN_BASE_YEAR = 386;
const SEASON_ANCHOR_DATE = {
  spring: [4, 6],   // 春深落英：四月初六（清明谷雨桃花盛时）
  summer: [6, 12],  // 夏初新荷：六月十二（孟夏荷钱初展）
  autumn: [9, 18],  // 秋熟金粟：九月十八（仲秋金粟盈畴）
  winter: [12, 20]  // 冬寂薄雪：十二月二十（仲冬薄雪覆瓦）
};
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const SOLAR_TERMS = [
  [1, 5, '小寒', '寒云覆岭，溪岸微霜初凝'],
  [1, 20, '大寒', '岁暮天清，村舍炊烟最暖'],
  [2, 4, '立春', '东风解冻，溪柳暗生新芽'],
  [2, 19, '雨水', '细雨润畦，山涧泉声渐活'],
  [3, 5, '惊蛰', '春雷未动，桃枝已含红蕾'],
  [3, 20, '春分', '昼夜平分，夹岸芳草鲜美'],
  [4, 5, '清明', '桃林落英渐繁，溪水初暖'],
  [4, 20, '谷雨', '细雨润秧，春茶新芽初展'],
  [5, 5, '立夏', '桑叶满枝，南风拂过田畴'],
  [5, 21, '小满', '麦穗初盈，竹林蝉影微动'],
  [6, 6, '芒种', '水田插秧正忙，池荷初绽'],
  [6, 21, '夏至', '莲叶满池，昼长蛙声满院'],
  [7, 7, '小暑', '荷风送爽，茅亭宜对六博'],
  [7, 23, '大暑', '蝉鸣深竹，流水筒车不歇'],
  [8, 7, '立秋', '云淡天高，稻穗渐泛微金'],
  [8, 23, '处暑', '暑气渐收，晚霞染遍山谷'],
  [9, 8, '白露', '蒹葭微凉，秋禾日渐垂实'],
  [9, 23, '秋分', '金粟盈畴，晒场稻香满村'],
  [10, 8, '寒露', '露重草寒，枫林初染丹砂'],
  [10, 23, '霜降', '晓霜覆檐，菊影映满柴扉'],
  [11, 7, '立冬', '水落石出，归鸟早栖林梢'],
  [11, 22, '小雪', '山岚清冷，茅舍炉火初温'],
  [12, 7, '大雪', '寒林疏影，千山欲覆素雪'],
  [12, 21, '冬至', '岁寒日短，围炉夜话正暖']
];

export function getSolarTerm(month1Based, day1Based) {
  const m = Math.max(1, Math.min(12, Math.floor(Number(month1Based) || 1)));
  const d = Math.max(1, Math.min(31, Math.floor(Number(day1Based) || 1)));
  const md = m * 100 + d;
  let picked = SOLAR_TERMS[SOLAR_TERMS.length - 1];
  for (let i = 0; i < SOLAR_TERMS.length; i++) {
    const [tm, td] = SOLAR_TERMS[i];
    if (md >= tm * 100 + td) picked = SOLAR_TERMS[i];
  }
  return { name: picked[2], whisper: picked[3] };
}

function daysInMonth(year, month1Based) {
  if (month1Based === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return leap ? 29 : 28;
  }
  return MONTH_DAYS[(month1Based - 1) % 12];
}

export function formatModernEraTime(hour, dayCount = 1, phenologyId = 'spring') {
  const anchor = SEASON_ANCHOR_DATE[phenologyId] || SEASON_ANCHOR_DATE.spring;
  let year = MODERN_BASE_YEAR;
  let month = anchor[0];
  let day = anchor[1] + Math.max(0, Math.floor((Number(dayCount) || 1) - 1));
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  const wrappedHour = ((Number(hour) || 0) % 24 + 24) % 24;
  const totalMinutes = Math.floor(wrappedHour * 60 + 1e-6) % 1440;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const pad2 = n => (n < 10 ? '0' + n : String(n));
  const text = `公元${year}年${pad2(month)}月${pad2(day)}日 ${pad2(hh)}时${pad2(mm)}分`;
  const solarTerm = getSolarTerm(month, day);
  return {
    year,
    month,
    day,
    hour24: hh,
    minute: mm,
    solarTerm: solarTerm.name,
    solarWhisper: solarTerm.whisper,
    text
  };
}

export function formatNextSolarEvent(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  let kind;
  let targetName;
  let diffHours;
  if (h >= 5 && h < 17) {
    kind = 'sunset';
    targetName = '日落';
    diffHours = 17 - h;
  } else {
    kind = 'sunrise';
    targetName = '破晓';
    diffHours = h >= 17 ? (24 - h + 5) : (5 - h);
  }
  const minutesUntil = Math.max(1, Math.round(diffHours * 60));
  const hrs = Math.floor(minutesUntil / 60);
  const mins = minutesUntil % 60;
  const pad2 = n => (n < 10 ? '0' + n : String(n));
  const spanText = hrs > 0
    ? (mins > 0 ? `${hrs}小时${pad2(mins)}分` : `${hrs}小时`)
    : `${mins}分钟`;
  return {
    kind,
    minutesUntil,
    label: `距${targetName}约 ${spanText}`
  };
}

/**
 * 桃花源连续十二时辰时间系统：
 * 默认 720 秒（12 分钟，每时辰约 1 分钟）为一昼夜悠缓流转，驱动天光与炊烟节律；
 * 若处于 ?bench / ?shot / ?time= 模式或调用 sky.setAuto(false)，则自动退让为静止天时。
 */
export function createWorldClock({ sky, smoke, getPhenology, doc, win, onDawn, onPhaseChange, cycleSeconds = 720 } = {}) {
  const search = win?.location?.search || '';
  const disabledByUrl = /[?&](bench|shot|time)(?:=|&|$)/.test(search);

  let auto = !disabledByUrl;
  let speedScale = 1;
  let hour = PHASE_ANCHOR_HOURS[sky?.timeId] ?? 9.5;
  let lastPhase = sky?.timeId || hourToPhase(hour);
  let dayCount = 1;
  let clockHudTimer = 0;

  const origSetTime = typeof sky?.setTime === 'function' ? sky.setTime.bind(sky) : null;
  const origCycleTime = typeof sky?.cycleTime === 'function' ? sky.cycleTime.bind(sky) : null;
  const origSetAuto = typeof sky?.setAuto === 'function' ? sky.setAuto.bind(sky) : null;

  // 关闭 sky.js 内置简易轮转，由 worldClock 统一精确驱动昼夜节律
  if (origSetAuto) origSetAuto(false);

  function syncPhaseFromJump(nextId, cycleDir = 0) {
    if (PHASE_ANCHOR_HOURS[nextId] !== undefined) {
      hour = PHASE_ANCHOR_HOURS[nextId];
    }
    if (nextId !== lastPhase) {
      const prev = lastPhase;
      lastPhase = nextId;
      // 手动按 T 正向跨过子夜（夜 -> 晨）时自然推进历日与月相盈亏
      if (cycleDir > 0 && prev === 'night' && nextId === 'dawn') {
        dayCount++;
      }
      if (nextId === 'dawn') onDawn?.(prev, nextId);
      onPhaseChange?.(nextId, prev);
    }
    sky?.setLunarDay?.(dayCount);
    syncHud(true);
  }

  if (sky) {
    sky.setTime = function (id) {
      origSetTime?.(id);
      const cur = sky.timeId || id;
      syncPhaseFromJump(cur, 0);
    };
    sky.cycleTime = function (dir) {
      origCycleTime?.(dir);
      const cur = sky.timeId;
      syncPhaseFromJump(cur, Number(dir) || 1);
    };
    sky.setAuto = function (on) {
      auto = !!on;
      // 始终保持底层 sky.js autoOn = false，防止与 worldClock 双重计时
      origSetAuto?.(false);
      sky?.setLunarDay?.(dayCount);
      syncHud(true);
    };
  }

  function mealSmokeFactor(h) {
    // 卯辰早炊 (05:30~08:30) 与 申酉晚炊 (16:30~19:00) 炊烟更浓
    const morn = Math.max(0, 1 - Math.abs(h - 6.8) / 1.8);
    const eve = Math.max(0, 1 - Math.abs(h - 17.6) / 1.6);
    return 0.72 + 0.55 * Math.max(morn, eve);
  }

  const tEl = doc?.getElementById?.('sky-time') || null;
  const tRow = doc?.getElementById?.('sky-time-row') || tEl?.parentNode || null;
  let modernEl = doc?.getElementById?.('sky-modern-time') || null;
  let clockToastTimer = null;
  if (!modernEl && doc) {
    const skyBox = doc.getElementById?.('sky') || null;
    if (skyBox && typeof doc.createElement === 'function') {
      const created = doc.createElement('div');
      created.id = 'sky-modern-time';
      created.className = 'sky__modern';
      if (typeof skyBox.insertBefore === 'function' && skyBox.firstChild) {
        skyBox.insertBefore(created, skyBox.firstChild);
      } else if (typeof skyBox.prepend === 'function') {
        skyBox.prepend(created);
      } else if (typeof skyBox.appendChild === 'function') {
        skyBox.appendChild(created);
      }
      modernEl = created;
    }
  }
  if (tEl?.dataset) tEl.dataset.worldClockManaged = '1';

  let lastModernKey = -1;
  let lastModernText = '';

  function readPhenologyId() {
    const ph = typeof getPhenology === 'function' ? getPhenology() : getPhenology;
    if (typeof ph === 'string') return ph;
    return ph?.currentId || ph?.getState?.()?.id || 'spring';
  }

  function isClockUiBlocked() {
    const cls = doc?.body?.classList;
    if (cls?.contains?.('map-open') || cls?.contains?.('field-guide-open') || cls?.contains?.('ui-hidden') || cls?.contains?.('traveler-guide-open') || cls?.contains?.('quest-open') || cls?.contains?.('cruise-active')) return true;
    if (doc?.getElementById?.('journal')?.open) return true;
    if (doc?.getElementById?.('scroll-dialog')?.open) return true;
    return false;
  }

  function showClockToast(msg, durationMs = 2000) {
    const toastEl = doc?.getElementById?.('sky-toast');
    if (!toastEl || !msg) return;
    toastEl.textContent = msg;
    toastEl.classList?.add?.('show');
    if (clockToastTimer) clearTimeout(clockToastTimer);
    clockToastTimer = setTimeout(() => {
      toastEl.classList?.remove?.('show');
      clockToastTimer = null;
    }, durationMs);
    if (clockToastTimer && typeof clockToastTimer.unref === 'function') clockToastTimer.unref();
  }

  function announceSpeed() {
    const msg = !auto
      ? '时辰流速　已暂停流转'
      : speedScale >= 10
        ? `时辰流速　${speedScale}× 观日影`
        : speedScale > 1.5
          ? `时辰流速　${speedScale}× 快进`
          : '时辰流速　悠缓流转';
    showClockToast(msg, 2000);
  }

  function toggleClockSpeed(e) {
    if (isClockUiBlocked()) return;
    e?.stopPropagation?.();
    if (e?.shiftKey) {
      if (auto && speedScale >= 10) {
        speedScale = 1;
      } else {
        auto = true;
        speedScale = 12;
      }
    } else if (!auto) {
      auto = true;
      speedScale = 1;
    } else if (speedScale < 2) {
      speedScale = 4;
    } else {
      auto = false;
      speedScale = 1;
    }
    syncHud(true);
    sky?.setLunarDay?.(dayCount);
    announceSpeed();
  }

  function syncHud(force = false) {
    const phenId = readPhenologyId();
    const seasonIdx = phenId === 'summer' ? 1 : phenId === 'autumn' ? 2 : phenId === 'winter' ? 3 : 0;
    const wrappedH = ((hour % 24) + 24) % 24;
    const minuteOfDay = Math.floor(wrappedH * 60 + 1e-6) % 1440;
    const modernKey = ((dayCount * 4 + seasonIdx) * 1440) + minuteOfDay;
    const speedLabel = !auto
      ? '已暂停'
      : speedScale >= 10
        ? `${speedScale}× 观日影`
        : speedScale > 1.5
          ? `${speedScale}× 快进`
          : '悠缓默认';
    const speedKey = !auto ? 'paused' : speedScale >= 10 ? '12x' : speedScale > 1.5 ? '4x' : '1x';

    if (modernEl) {
      if (modernEl.dataset && modernEl.dataset.speed !== speedKey) {
        modernEl.dataset.speed = speedKey;
      }
      if (force || modernKey !== lastModernKey) {
        lastModernKey = modernKey;
        const mod = formatModernEraTime(wrappedH, dayCount, phenId);
        lastModernText = mod.text;
        if (modernEl.textContent !== mod.text) modernEl.textContent = mod.text;
        const scForTip = formatShichen(wrappedH);
        const solarTip = formatNextSolarEvent(wrappedH).label;
        if (modernEl.title !== undefined) {
          modernEl.title = `东晋太元十一年 · ${mod.solarTerm}（《桃花源记》“晋太元中”）· 对应古时辰：${scForTip.full} · ${solarTip} · 当前${speedLabel}（点击切 4×/暂停 · Shift+点击切 12× 观日影）`;
        }
      }
    }

    if (!tEl) return;
    if (!force && clockHudTimer < 0.25 && tEl.textContent && tEl.textContent.includes('·')) return;
    clockHudTimer = 0;
    const phase = sky?.timeId || hourToPhase(hour);
    const phaseLabel = PHASE_NAMES[phase] || '昼';
    const sc = formatShichen(hour);
    const speedTag = !auto ? '·停' : speedScale > 1.5 ? `·${speedScale}x` : '';
    const nextText = `${phaseLabel}·${sc.short}${speedTag}`;
    if (tEl.textContent !== nextText) tEl.textContent = nextText;
    const lunarName = phase === 'night' ? (sky?.getLunarState?.()?.name || '') : '';
    const lunarSuffix = lunarName ? ` · 月相：${lunarName}` : '';
    const tip = `天时：${sc.full}${lastModernText ? `（${lastModernText}）` : ''}${lunarSuffix}（按 T 或点击切换：晨 / 昼 / 暮 / 夜）`;
    tEl.title = tip;
    if (tRow) tRow.title = tip;
  }

  if (modernEl && doc && typeof modernEl.addEventListener === 'function') {
    if (modernEl.style) {
      modernEl.style.cursor = 'pointer';
      modernEl.style.pointerEvents = 'auto';
    }
    modernEl.addEventListener('click', toggleClockSpeed);
  }

  syncHud(true);
  sky?.setLunarDay?.(dayCount);

  function setHour(nextHour) {
    if (!Number.isFinite(nextHour)) return;
    const wrapped = ((nextHour % 24) + 24) % 24;
    const prevPhase = lastPhase;
    hour = wrapped;
    const targetPhase = hourToPhase(hour);
    if (targetPhase !== prevPhase) {
      origSetTime?.(targetPhase);
      lastPhase = targetPhase;
      if (targetPhase === 'dawn') onDawn?.(prevPhase, targetPhase);
      onPhaseChange?.(targetPhase, prevPhase);
    }
    syncHud(true);
  sky?.setLunarDay?.(dayCount);
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const clampedDt = Math.min(0.1, dt);
    clockHudTimer += clampedDt;

    if (sky?.timeId && sky.timeId !== lastPhase) {
      syncPhaseFromJump(sky.timeId);
    }

    if (auto) {
      const hoursPerSec = (24 / cycleSeconds) * speedScale;
      const prevHour = hour;
      hour += clampedDt * hoursPerSec;
      if (hour >= 24) {
        const phenId = readPhenologyId();
        const prevMod = formatModernEraTime(23.9, dayCount, phenId);
        hour -= 24;
        dayCount++;
        sky?.setLunarDay?.(dayCount);
        if (!disabledByUrl && !isClockUiBlocked()) {
          const nextMod = formatModernEraTime(hour, dayCount, phenId);
          if (nextMod.solarTerm !== prevMod.solarTerm) {
            showClockToast(`节气更迭 · ${nextMod.solarTerm}　${nextMod.solarWhisper}`, 3600);
          } else {
            const pad2 = n => (n < 10 ? '0' + n : String(n));
            showClockToast(`历日新添 · 公元${nextMod.year}年${pad2(nextMod.month)}月${pad2(nextMod.day)}日 · ${nextMod.solarTerm}`, 2600);
          }
        }
      }
      const nextPhase = hourToPhase(hour);
      if (nextPhase !== lastPhase) {
        const prev = lastPhase;
        origSetTime?.(nextPhase);
        lastPhase = sky?.timeId || nextPhase;
        if (lastPhase === 'dawn' || (prevHour < 5 && hour >= 5)) {
          onDawn?.(prev, lastPhase);
        }
        onPhaseChange?.(lastPhase, prev);
      }
    }

    if (smoke?.group) {
      const f = mealSmokeFactor(hour);
      smoke.group.scale.y = 0.85 + (f - 0.72) * 0.65;
    }
    syncHud(false);
  }

  function getState() {
    const sc = formatShichen(hour);
    const mod = formatModernEraTime(hour, dayCount, readPhenologyId());
    const nextSolarEvent = formatNextSolarEvent(hour);
    return {
      hour,
      shichen: sc.name,
      short: sc.short,
      full: sc.full,
      modernText: mod.text,
      solarTerm: mod.solarTerm,
      solarWhisper: mod.solarWhisper,
      nextSolarEvent,
      year: mod.year,
      month: mod.month,
      day: mod.day,
      hour24: mod.hour24,
      minute: mod.minute,
      phase: sky?.timeId || hourToPhase(hour),
      auto,
      speedScale,
      cycleSeconds,
      dayCount
    };
  }

  function dispose() {
    if (clockToastTimer) {
      clearTimeout(clockToastTimer);
      clockToastTimer = null;
    }
    modernEl?.removeEventListener?.('click', toggleClockSpeed);
  }

  return {
    update,
    setHour,
    setAuto(on) { sky?.setAuto ? sky.setAuto(on) : (auto = !!on); },
    setSpeed(s) { if (Number.isFinite(s) && s >= 0) { speedScale = s; syncHud(true); } },
    getState,
    dispose
  };
}

/**
 * 晴夜流星：单 Mesh 池化拖尾片（仅在晴夜可见，其余时段自动隐藏且 0 drawCall）。
 * 不侵入 sky.js 场景树，保证原有昼夜与暮光基准校验完全一致。
 */
export function createNightMeteors({ scene } = {}) {
  const POOL = 4;
  const VERTS_PER_METEOR = 4;
  const TRIS_PER_METEOR = 2;
  const rand = lcg(7919);

  const positions = new Float32Array(POOL * VERTS_PER_METEOR * 3);
  const colors = new Float32Array(POOL * VERTS_PER_METEOR * 3);
  const indices = [];
  for (let i = 0; i < POOL; i++) {
    const b = i * VERTS_PER_METEOR;
    // Triangle pair forming an elongated luminous diamond tail: head(0) - left(1) - right(2) - tail(3)
    indices.push(b + 0, b + 1, b + 2, b + 1, b + 3, b + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide
  });
  mat.userData.skyIgnore = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'night-meteors';
  mesh.visible = false;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'night-meteors-group';
  group.add(mesh);
  scene?.add?.(group);

  const pool = Array.from({ length: POOL }, () => ({
    active: false,
    age: 0,
    duration: 1.3,
    sx: 0, sy: 0, sz: 0,
    dx: 0, dy: 0, dz: 0,
    speed: 65,
    len: 26,
    width: 0.72,
    tint: 0
  }));

  let nextCooldown = 1.6;
  let wasNight = false;
  let spawnedCount = 0;
  let disposed = false;

  const _dir = new THREE.Vector3();
  const _view = new THREE.Vector3();
  const _side = new THREE.Vector3();

  function spawnMeteor(origin = { x: 0, y: 0, z: 0 }) {
    const slot = pool.find(m => !m.active) || pool[0];
    const az = rand() * Math.PI * 2;
    const el = 0.50 + rand() * 0.54; // 29°..60° above horizon
    const r = 290;
    const ce = Math.cos(el);
    slot.sx = (origin.x || 0) + Math.cos(az) * ce * r;
    slot.sy = (origin.y || 0) + Math.sin(el) * r;
    slot.sz = (origin.z || 0) + Math.sin(az) * ce * r;

    // Streak tangentially across the upper dome, angled cleanly downward (-Y)
    const tangX = -Math.sin(az);
    const tangZ = Math.cos(az);
    const dirSign = rand() > 0.5 ? 1 : -1;
    _dir.set(
      tangX * dirSign * (0.72 + rand() * 0.28) + (rand() - 0.5) * 0.25,
      -(0.42 + rand() * 0.36),
      tangZ * dirSign * (0.72 + rand() * 0.28) + (rand() - 0.5) * 0.25
    ).normalize();

    slot.dx = _dir.x;
    slot.dy = _dir.y;
    slot.dz = _dir.z;
    slot.active = true;
    slot.age = 0;
    slot.duration = 1.05 + rand() * 0.65;
    slot.speed = 62 + rand() * 34;
    slot.len = 22 + rand() * 14;
    slot.width = 0.58 + rand() * 0.34;
    slot.tint = rand();
    spawnedCount++;
    return slot;
  }

  function clearVertex(idx) {
    const base = idx * VERTS_PER_METEOR * 3;
    for (let k = 0; k < VERTS_PER_METEOR * 3; k++) {
      positions[base + k] = 0;
      colors[base + k] = 0;
    }
  }

  function update(dt, sky, cam) {
    if (disposed) return;
    const isClearNight = sky?.timeId === 'night' && (sky?.rainIntensity ?? 0) < 0.22;
    if (!isClearNight) {
      wasNight = false;
      mesh.visible = false;
      for (const m of pool) m.active = false;
      return;
    }

    const origin = cam?.position || { x: 0, y: 8, z: 0 };
    if (!wasNight) {
      wasNight = true;
      nextCooldown = 1.2; // 切入晴夜很快便能看见第一颗流星
    }

    const step = Math.min(0.1, Math.max(0, dt || 0));
    nextCooldown -= step;
    if (nextCooldown <= 0) {
      spawnMeteor(origin);
      nextCooldown = 4.2 + rand() * 5.2;
    }

    let anyActive = false;
    for (let i = 0; i < POOL; i++) {
      const m = pool[i];
      if (!m.active) {
        clearVertex(i);
        continue;
      }
      m.age += step;
      const t = m.age / m.duration;
      if (t >= 1) {
        m.active = false;
        clearVertex(i);
        continue;
      }
      anyActive = true;
      const dist = m.age * m.speed;
      const hx = m.sx + m.dx * dist;
      const hy = m.sy + m.dy * dist;
      const hz = m.sz + m.dz * dist;

      const tailLen = m.len * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5);
      const midX = hx - m.dx * (tailLen * 0.22);
      const midY = hy - m.dy * (tailLen * 0.22);
      const midZ = hz - m.dz * (tailLen * 0.22);
      const tx = hx - m.dx * tailLen;
      const ty = hy - m.dy * tailLen;
      const tz = hz - m.dz * tailLen;

      _dir.set(m.dx, m.dy, m.dz);
      _view.set(hx - origin.x, hy - origin.y, hz - origin.z).normalize();
      _side.crossVectors(_dir, _view);
      if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
      _side.normalize().multiplyScalar(m.width);

      const base = i * VERTS_PER_METEOR * 3;
      // 0: head tip
      positions[base + 0] = hx; positions[base + 1] = hy; positions[base + 2] = hz;
      // 1: shoulder left
      positions[base + 3] = midX + _side.x; positions[base + 4] = midY + _side.y; positions[base + 5] = midZ + _side.z;
      // 2: shoulder right
      positions[base + 6] = midX - _side.x; positions[base + 7] = midY - _side.y; positions[base + 8] = midZ - _side.z;
      // 3: vanishing tail
      positions[base + 9] = tx; positions[base + 10] = ty; positions[base + 11] = tz;

      const fade = Math.sin(t * Math.PI);
      const headB = Math.min(1, fade * 1.25);
      const midB = fade * 0.72;
      // Head warm cream-white
      colors[base + 0] = headB * 1.0;
      colors[base + 1] = headB * 0.97;
      colors[base + 2] = headB * 0.88;
      // Shoulders cool sapphire-cyan or warm amber-gold tint
      const rTint = m.tint > 0.7 ? 0.92 : 0.62;
      const gTint = m.tint > 0.7 ? 0.82 : 0.84;
      const bTint = m.tint > 0.7 ? 0.64 : 1.0;
      colors[base + 3] = midB * rTint; colors[base + 4] = midB * gTint; colors[base + 5] = midB * bTint;
      colors[base + 6] = midB * rTint; colors[base + 7] = midB * gTint; colors[base + 8] = midB * bTint;
      // Tail fades to zero
      colors[base + 9] = 0; colors[base + 10] = 0; colors[base + 11] = 0;
    }

    mesh.visible = anyActive;
    if (anyActive) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
  }

  function getStats() {
    return {
      visible: mesh.visible,
      activeCount: pool.filter(m => m.active).length,
      spawnedCount,
      drawCalls: mesh.visible ? 1 : 0,
      triangles: mesh.visible ? POOL * TRIS_PER_METEOR : 0,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    geo.dispose();
    mat.dispose();
    group.removeFromParent();
  }

  return { group, spawnMeteor, update, getStats, dispose };
}
