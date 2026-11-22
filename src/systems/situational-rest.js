import { sampleGroundSurface } from '../world/ground-surface.js';
import { interactionAllowed, mysteryUiPaused, storyBusy } from './mysteries.js';

const TAU = Math.PI * 2;
const CONTROL_SELECTOR = 'input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="textbox"], [role="slider"]';
const EXIT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Escape'
]);

const FEAST_OPENING_NOTE = '主人执盏相邀：「山中无历日，难得远客至，满饮此杯新酿粟酒！」';
const FEAST_TOAST_NOTES = [
  '再敬一盏——席间老幼笑语晏晏，新炊黍香与醇酒暖意满院。',
  '宾主举耳杯同饮，瓦盆鸡黍热气腾腾，浑忘尘世岁月。',
  '主家添酒劝菜：「村酿虽薄，皆是自家春耕秋收所得，请再满饮！」'
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function wrapAngle(a) {
  let d = a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function boxDistance(x, z, b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) return Infinity;
  if (Number.isFinite(b.r) && !Number.isFinite(b.hw)) {
    return Math.max(0, Math.hypot(x - b.x, z - b.z) - b.r);
  }
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const dx = x - b.x;
  const dz = z - b.z;
  const hw = b.hw ?? 0;
  const hd = b.hd ?? 0;
  return Math.hypot(
    Math.max(0, Math.abs(dx * c - dz * s) - hw),
    Math.max(0, Math.abs(dx * s + dz * c) - hd)
  );
}

function readEnv(sky) {
  const app = sky?.getAppearance?.();
  const rain = Math.max(0, Math.min(1, Number(sky?.rainIntensity ?? app?.rainIntensity ?? 0) || 0));
  const weatherId = sky?.weatherId ?? app?.weatherId ?? (rain > 0.2 ? 'rain' : 'clear');
  const timeId = sky?.timeId ?? app?.timeId ?? 'day';
  const tw = sky?.getTwilightState?.();
  const isNight = timeId === 'night' || timeId === 'dusk';
  const isDawn = timeId === 'dawn' || (!isNight && (tw?.dawn ?? 0) > 0.25);
  return { rain, weatherId, timeId, isNight, isDawn };
}

export function createSituationalRest(options = {}) {
  const ctx = {
    world: options.world || null,
    field: options.field || null,
    player: options.player || null,
    avatar: options.avatar || null,
    camera: options.camera || null,
    sound: options.sound || null,
    sky: options.sky || null,
    blockers: options.blockers || [],
    hospitalityFeast: options.hospitalityFeast || null,
    leisureGrove: options.leisureGrove || null,
    qinHanCompletion: options.qinHanCompletion || null,
    valleyBorderlands: options.valleyBorderlands || null,
    outerWilds: options.outerWilds || null,
    deepHollows: options.deepHollows || null,
    mysteries: options.mysteries || null,
    doc: options.doc || (typeof document !== 'undefined' ? document : null),
    win: options.win || (typeof window !== 'undefined' ? window : null)
  };

  let disposed = false;
  let active = false;
  let currentSeat = null;
  let sitProgress = 0;
  let toastCount = 0;
  let toastCooldown = 0;
  let sitKeyCooldown = 0;
  let noteTimer = 0;
  let noteActive = false;
  let lastNoteText = '';
  let lastAction = null;

  let originPos = { x: 0, y: 0, z: 0 };
  let syncedPos = { x: 0, y: 0, z: 0 };
  let exitOffset = { x: 0, y: 0, z: 0 };
  let aimRemYaw = 0;
  let aimRemPitch = 0;

  let staticSeats = [];
  let cleanupListeners = null;

  function surface(x, z) {
    if (!ctx.field) return 0;
    return sampleGroundSurface(ctx.field, x, z);
  }

  function waterLevel() {
    return ctx.world?.terrain?.waterLevel ?? -1.2;
  }

  function gatherBlockers() {
    const out = [];
    if (Array.isArray(ctx.blockers)) out.push(...ctx.blockers);
    if (Array.isArray(ctx.hospitalityFeast?.blockers)) out.push(...ctx.hospitalityFeast.blockers);
    if (Array.isArray(ctx.leisureGrove?.blockers)) out.push(...ctx.leisureGrove.blockers);
    if (Array.isArray(ctx.outerWilds?.blockers)) out.push(...ctx.outerWilds.blockers);
    if (Array.isArray(ctx.deepHollows?.blockers)) out.push(...ctx.deepHollows.blockers);
    return out;
  }

  function isDryAndClear(x, z, clearance = 0.46) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const gy = surface(x, z);
    if (!Number.isFinite(gy) || gy < waterLevel() + 0.22) return false;
    const pond = ctx.world?.terrain?.pond;
    if (pond && Number.isFinite(pond.x) && Number.isFinite(pond.z)) {
      const pr = (pond.waterRadius || pond.radius || 8.5) + 0.35;
      if (Math.hypot(x - pond.x, z - pond.z) < pr && gy < (pond.waterY ?? gy) + 0.12) return false;
    }
    const allBlockers = gatherBlockers();
    for (let i = 0; i < allBlockers.length; i++) {
      const b = allBlockers[i];
      if (Number.isFinite(b.maxY) && b.maxY < gy + 0.14) continue;
      if (Number.isFinite(b.minY) && b.minY > gy + 1.85) continue;
      if (boxDistance(x, z, b) < clearance) return false;
    }
    return true;
  }

  function findSafeExitPosition(seat, fallbackPos) {
    const prefAngle = Number.isFinite(seat.exitAngle)
      ? seat.exitAngle
      : Math.atan2(
          (fallbackPos?.z ?? seat.z) - (seat.lookZ ?? seat.z),
          (fallbackPos?.x ?? seat.x) - (seat.lookX ?? seat.x)
        );
    const radii = [0.76, 0.92, 1.10, 1.32];
    const angleOffsets = [0, 0.45, -0.45, 0.95, -0.95, 1.55, -1.55, Math.PI];
    for (const r of radii) {
      for (const da of angleOffsets) {
        const ang = prefAngle + da;
        const tx = seat.x + Math.cos(ang) * r;
        const tz = seat.z + Math.sin(ang) * r;
        if (isDryAndClear(tx, tz, 0.46)) {
          return { x: tx, y: surface(tx, tz), z: tz };
        }
      }
    }
    if (fallbackPos && isDryAndClear(fallbackPos.x, fallbackPos.z, 0.36)) {
      return { x: fallbackPos.x, y: surface(fallbackPos.x, fallbackPos.z), z: fallbackPos.z };
    }
    const fx = seat.x + Math.cos(prefAngle) * 0.85;
    const fz = seat.z + Math.sin(prefAngle) * 0.85;
    return { x: fx, y: surface(fx, fz), z: fz };
  }

  function rebuildSeats() {
    const discovered = [];

    // 1. Feast guest stool: 入席共饮 · 鸡黍村宴
    const gs = ctx.hospitalityFeast?.getGuestSeat?.() || ctx.hospitalityFeast?.layout?.guestSeat;
    const feastSite = ctx.hospitalityFeast?.layout?.site;
    if (gs && Number.isFinite(gs.x) && Number.isFinite(gs.z)) {
      const gy = Number.isFinite(gs.y) ? gs.y : surface(gs.x, gs.z);
      const centerX = feastSite?.x ?? (gs.x - 0.38);
      const centerZ = feastSite?.z ?? (gs.z + 0.82);
      discovered.push({
        id: 'feast-seat',
        name: '鸡黍村宴',
        prompt: '入席共饮 · 鸡黍村宴',
        x: gs.x,
        y: gy,
        z: gs.z,
        seatY: Number.isFinite(gs.seatY) ? gs.seatY : 0.32,
        lookX: Number.isFinite(gs.lookX) ? gs.lookX : centerX - 0.08,
        lookY: Number.isFinite(gs.lookY) ? gs.lookY : gy + 0.72,
        lookZ: Number.isFinite(gs.lookZ) ? gs.lookZ : centerZ + 0.05,
        exitAngle: Math.atan2(gs.z - centerZ, gs.x - centerX)
      });
    }

    // 2. Waterside pavilion stone stool: 落座观荷 · 临水茅亭
    const lgLayout = ctx.leisureGrove?.layout;
    const pav = lgLayout?.pavilion || (lgLayout?.regions || []).find(r => r.kind === 'pavilion');
    if (pav && Number.isFinite(pav.x) && Number.isFinite(pav.z)) {
      const pond = ctx.world?.terrain?.pond;
      const stations = ctx.leisureGrove?.stations || [];
      const stoolOffsets = [
        [0, -1.28],
        [0, 1.28],
        [-1.25, 0],
        [1.25, 0]
      ];
      const candidates = [];
      for (const [ox, oz] of stoolOffsets) {
        const sx = pav.x + ox;
        const sz = pav.z + oz;
        const occupied = stations.some(st => Math.hypot((st.x ?? 0) - sx, (st.z ?? 0) - sz) < 0.95);
        if (occupied) continue;
        const pondDist = pond && Number.isFinite(pond.x) && Number.isFinite(pond.z)
          ? Math.hypot(sx - pond.x, sz - pond.z)
          : Math.hypot(ox, oz + 2);
        candidates.push({ sx, sz, ox, oz, pondDist });
      }
      candidates.sort((a, b) => a.pondDist - b.pondDist);
      const picked = candidates[0] || { sx: pav.x, sz: pav.z - 1.28, ox: 0, oz: -1.28 };
      const sy = surface(picked.sx, picked.sz);
      const lookX = pond && Number.isFinite(pond.x) ? pond.x : pav.x;
      const lookZ = pond && Number.isFinite(pond.z) ? pond.z : pav.z - 10;
      const lookY = pond && Number.isFinite(pond.waterY) ? pond.waterY + 0.35 : sy + 0.45;
      discovered.push({
        id: 'pavilion-seat',
        name: '临水茅亭',
        prompt: '落座观荷 · 临水茅亭',
        x: picked.sx,
        y: sy,
        z: picked.sz,
        seatY: 0.43,
        lookX,
        lookY,
        lookZ,
        exitAngle: Math.atan2(picked.oz, picked.ox || 0.25)
      });
    }

    // 3. Ancient social tree bench: 树下小憩 · 古社树
    const st = lgLayout?.socialTree || (lgLayout?.regions || []).find(r => r.kind === 'social-tree');
    if (st && Number.isFinite(st.x) && Number.isFinite(st.z)) {
      const stations = ctx.leisureGrove?.stations || [];
      const benchCandidates = [
        [2.05, -0.08],
        [2.05, 0.38],
        [-1.65, 0.35]
      ];
      let bx = st.x + 2.05;
      let bz = st.z - 0.08;
      for (const [ox, oz] of benchCandidates) {
        const cx = st.x + ox;
        const cz = st.z + oz;
        const occupied = stations.some(item => Math.hypot((item.x ?? 0) - cx, (item.z ?? 0) - cz) < 0.85);
        if (!occupied) {
          bx = cx;
          bz = cz;
          break;
        }
      }
      const by = surface(bx, bz);
      const benchTop = (Number.isFinite(st.y) ? st.y : by) + 0.49;
      discovered.push({
        id: 'social-tree-seat',
        name: '古社树',
        prompt: '树下小憩 · 古社树',
        x: bx,
        y: by,
        z: bz,
        seatY: Math.max(0.34, Math.min(0.54, benchTop - by)),
        lookX: st.x - 0.35,
        lookY: (Number.isFinite(st.y) ? st.y : by) + 1.38,
        lookZ: st.z + 0.90,
        exitAngle: Math.atan2(bz - st.z, bx - st.x)
      });
    }

    for (const mod of [ctx.valleyBorderlands, ctx.outerWilds, ctx.deepHollows]) {
      if (!Array.isArray(mod?.restSeats)) continue;
      for (const rs of mod.restSeats) {
        if (rs && Number.isFinite(rs.x) && Number.isFinite(rs.z)) {
          discovered.push({ ...rs });
        }
      }
    }

    staticSeats = discovered;
    return discovered;
  }

  function resolveBonfireSeat() {
    const nf = ctx.qinHanCompletion?.getNightFeastState?.();
    if (!nf || !nf.active || !Number.isFinite(nf.x) || !Number.isFinite(nf.z)) return null;
    if (nf.guestMat && Number.isFinite(nf.guestMat.x) && Number.isFinite(nf.guestMat.z)) {
      const mx = nf.guestMat.x;
      const mz = nf.guestMat.z;
      const my = Number.isFinite(nf.guestMat.y) ? nf.guestMat.y : surface(mx, mz);
      return {
        id: 'bonfire-mat',
        name: '晒场篝火',
        prompt: '围火夜话 · 晒场篝火',
        x: mx,
        y: my,
        z: mz,
        seatY: 0.08,
        lookX: nf.x,
        lookY: (Number.isFinite(nf.y) ? nf.y : my) + 0.48,
        lookZ: nf.z,
        exitAngle: Math.atan2(mz - nf.z, mx - nf.x)
      };
    }

    const actors = ctx.qinHanCompletion?.getInteractables?.() || [];
    const candidateAngles = [-0.35, 1.48, -2.25, 3.05, 0.15];
    for (const ang of candidateAngles) {
      const mx = nf.x + Math.cos(ang) * 1.68;
      const mz = nf.z + Math.sin(ang) * 1.68;
      const clearActors = actors.every(a => Math.hypot((a.x ?? 0) - mx, (a.z ?? 0) - mz) > 0.95);
      if (clearActors && isDryAndClear(mx, mz, 0.38)) {
        const my = surface(mx, mz);
        return {
          id: 'bonfire-mat',
          name: '晒场篝火',
          prompt: '围火夜话 · 晒场篝火',
          x: mx,
          y: my,
          z: mz,
          seatY: 0.08,
          lookX: nf.x,
          lookY: (Number.isFinite(nf.y) ? nf.y : my) + 0.48,
          lookZ: nf.z,
          exitAngle: ang
        };
      }
    }
    return null;
  }

  function getAvailableSeats() {
    if (!staticSeats.length) rebuildSeats();
    const list = staticSeats.slice();
    const bonfire = resolveBonfireSeat();
    if (bonfire) list.push(bonfire);
    return list;
  }

  function composeSeatNote(seat, isRetoast = false) {
    if (seat.id === 'feast-seat') {
      if (!isRetoast) return FEAST_OPENING_NOTE;
      return FEAST_TOAST_NOTES[(toastCount - 1 + FEAST_TOAST_NOTES.length) % FEAST_TOAST_NOTES.length];
    }
    const env = readEnv(ctx.sky);
    if (seat.id === 'pavilion-seat') {
      if (env.rain > 0.12 || env.weatherId === 'rain') {
        return '檐前雨丝如织，荷叶承珠，池鱼暗聚。';
      }
      if (env.isNight) {
        return '月色浸池，蛙鼓声声，凉风满亭。';
      }
      if (env.weatherId === 'mist' || env.isDawn) {
        return '薄雾笼池，新荷带露，水纹轻漾晨光。';
      }
      return '临水安坐，微风拂面，看锦鲤穿莲而过。';
    }
    if (seat.id === 'social-tree-seat') {
      if (env.rain > 0.12 || env.weatherId === 'rain') {
        return '古木浓荫蔽细雨，湿叶微香，村巷檐滴声声慢。';
      }
      if (env.isNight) {
        return '晚风拂动五色丝绦，社树影深，远处灯火温然。';
      }
      return '树荫匝地，五色丝绦随风轻拂，村巷鸡犬相闻。';
    }
    if (seat.id === 'bonfire-mat') {
      return '篝火噼啪作响，瓦釜蒸腾，缶歌伴着星河低回。';
    }
    if (seat.id === 'cloud-pavilion-seat') {
      if (env.rain > 0.12 || env.weatherId === 'rain') {
        return '茅檐听雨声潇潇，山岚漫过松竹，谷中屋舍如淡墨初染。';
      }
      if (env.isNight) {
        return '东皋夜静松风起，亭角暖灯微明，远望村火与星河相映。';
      }
      if (env.weatherId === 'mist' || env.isDawn) {
        return '凭栏俯瞰平畴烟树，白云自脚下松梢徐徐舒卷。';
      }
      return '高亭远眺，美池修竹、阡陌桑麻与四围青嶂一览无余。';
    }
    if (seat.id === 'watchtower-seat') {
      if (env.rain > 0.12 || env.weatherId === 'rain') {
        return '草楼深檐避雨，北涧泉声更急，层层梯田漾起万点水纹。';
      }
      if (env.isNight) {
        return '北垅蛙声伴着飞泉低响，梯田水镜倒映月华清辉。';
      }
      return '小坐草楼檐下，背后三叠泉鸣，眼前曲水梯田白鹭闲步。';
    }
    if (seat.id === 'mountain-tea-seat') {
      if (env.rain > 0.12 || env.weatherId === 'rain') {
        return '松寮茅檐听雨，泥炉瓦铫白汽微沸，一盏热茶暖彻山衣。';
      }
      if (env.isNight) {
        return '北岭风灯温然，松涛阵阵伴茶香，俯看全谷村火如星。';
      }
      if (env.weatherId === 'mist' || env.isDawn) {
        return '云雾漫过半坡野茶垄，泥炉松火微红，坐看山岚卷舒。';
      }
      return '竹凳小坐品新茗，脚下茶垄层叠，远处飞泉与平畴尽收眼底。';
    }
    return '';
  }

  function showNote(text, duration = 5.4) {
    if (!text) return;
    const noteEl = ctx.doc?.getElementById?.('mystery-note');
    lastNoteText = text;
    noteTimer = duration;
    noteActive = true;
    if (noteEl) {
      noteEl.textContent = text;
      noteEl.classList?.add?.('show');
    }
  }

  function hideNote() {
    if (!noteActive) return;
    noteActive = false;
    noteTimer = 0;
    const noteEl = ctx.doc?.getElementById?.('mystery-note');
    if (noteEl && (!lastNoteText || noteEl.textContent === lastNoteText)) {
      noteEl.classList?.remove?.('show');
    }
  }

  function playSeatSound(kind, x, z) {
    try {
      const unlocked = ctx.sound?.unlock?.();
      if (unlocked?.catch) unlocked.catch(() => {});
      if (kind === 'toast') {
        ctx.sound?.toastCup?.(x, z);
      } else {
        ctx.sound?.stoolSit?.(x, z);
      }
    } catch (_) {
      // Silent headless/browser environments still complete full visual interaction.
    }
  }

  function triggerFeastToast(isRetoast = false) {
    if (!currentSeat || currentSeat.id !== 'feast-seat') return null;
    ctx.hospitalityFeast?.triggerToast?.(4.5);
    playSeatSound('toast', currentSeat.x, currentSeat.z);
    if (isRetoast) toastCount++;
    toastCooldown = 0.85;
    const line = composeSeatNote(currentSeat, isRetoast);
    showNote(line, 5.2);
    lastAction = { id: 'feast-seat', action: isRetoast ? 'toast' : 'sit', toastCount, line };
    return lastAction;
  }

  function sitAt(seatOrId) {
    if (disposed) return null;
    const seats = getAvailableSeats();
    const seat = typeof seatOrId === 'string'
      ? seats.find(s => s.id === seatOrId)
      : seats.find(s => s.id === seatOrId?.id) || seatOrId;
    if (!seat || !Number.isFinite(seat.x) || !Number.isFinite(seat.z)) return null;

    const ps = ctx.player?.state;
    if (!ps || ps.aboardSkiff) return null;

    originPos = {
      x: Number.isFinite(ps.x) ? ps.x : seat.x,
      y: Number.isFinite(ps.y) ? ps.y : seat.y,
      z: Number.isFinite(ps.z) ? ps.z : seat.z
    };
    syncedPos = { ...originPos };
    exitOffset = { x: 0, y: 0, z: 0 };

    active = true;
    currentSeat = { ...seat };
    sitProgress = Math.max(0.02, sitProgress);
    sitKeyCooldown = 0.28;

    ps.vx = 0;
    ps.vz = 0;
    ps.speed = 0;
    ps.still = true;
    ps.seated = true;
    ps.seatId = seat.id;

    // Gentle initial camera orientation toward look target while preserving mouse freedom
    const dx = seat.lookX - seat.x;
    const dy = seat.lookY - (seat.y + seat.seatY + 0.78);
    const dz = seat.lookZ - seat.z;
    const dist3d = Math.hypot(dx, dy, dz) || 1;
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.max(-0.42, Math.min(0.32, Math.asin(Math.max(-1, Math.min(1, dy / dist3d)))));
    aimRemYaw = wrapAngle(targetYaw - (ps.yaw || 0));
    aimRemPitch = (targetPitch - (ps.pitch || 0)) * 0.85;

    if (ctx.avatar?.state) {
      ctx.avatar.state.sitAmount = sitProgress;
      ctx.avatar.state.seatOffsetY = seat.seatY;
    }

    playSeatSound('sit', seat.x, seat.z);

    if (seat.id === 'feast-seat') {
      toastCount = 0;
      return triggerFeastToast(false);
    }

    const line = composeSeatNote(seat, false);
    showNote(line, 5.6);
    lastAction = { id: seat.id, action: 'sit', line };
    return lastAction;
  }

  function standUp(immediate = false) {
    if (!active && sitProgress <= 0) return false;
    const ps = ctx.player?.state;
    const prevSeat = currentSeat;
    active = false;
    currentSeat = null;
    aimRemYaw = 0;
    aimRemPitch = 0;

    if (ps) {
      if (prevSeat) {
        const safe = findSafeExitPosition(prevSeat, originPos);
        exitOffset = immediate
          ? { x: 0, y: 0, z: 0 }
          : {
              x: (syncedPos.x - safe.x) * sitProgress,
              y: ((prevSeat.y + prevSeat.seatY + 0.78) - (safe.y + (ps.eyeHeight || 1.65))) * sitProgress,
              z: (syncedPos.z - safe.z) * sitProgress
            };
        ps.x = safe.x;
        ps.y = safe.y;
        ps.z = safe.z;
      }
      ps.seated = false;
      ps.seatId = null;
      if (!ps.aboardSkiff) {
        ps.still = false;
      }
    }

    if (immediate) {
      sitProgress = 0;
      exitOffset = { x: 0, y: 0, z: 0 };
      if (ctx.avatar?.state) {
        ctx.avatar.state.sitAmount = 0;
        ctx.avatar.state.seatOffsetY = 0;
      }
    }
    if (prevSeat) {
      lastAction = { id: prevSeat.id, action: 'stand' };
    }
    return true;
  }

  function pickTarget(camera, cfg) {
    if (disposed) return null;
    const doc = ctx.doc;
    if (doc && (!interactionAllowed(null, doc) || storyBusy(doc))) return null;

    const ps = ctx.player?.state;
    const cam = camera || ctx.camera;
    if (!ps || !cam || ps.aboardSkiff) return null;

    const third = ps.view === 'third';
    const eye = {
      x: third ? ps.x : cam.position.x,
      y: third ? (ps.y + (ps.eyeHeight || 1.65)) : cam.position.y,
      z: third ? ps.z : cam.position.z
    };
    const cp = Math.cos(ps.pitch || 0);
    const forward = {
      x: -Math.sin(ps.yaw || 0) * cp,
      y: Math.sin(ps.pitch || 0),
      z: -Math.cos(ps.yaw || 0) * cp
    };

    // While seated at the village feast, pressing E raises another cup ("再敬一盏")
    if (active && currentSeat) {
      if (currentSeat.id === 'feast-seat' && toastCooldown <= 0) {
        return {
          kind: 'mystery',
          key: 'rest:feast-toast',
          isRest: true,
          restAction: 'toast',
          seatId: 'feast-seat',
          name: '鸡黍村宴',
          label: '鸡黍村宴',
          prompt: '再敬一盏 · 鸡黍村宴',
          x: currentSeat.lookX,
          y: currentSeat.lookY,
          z: currentSeat.lookZ,
          dist: 0.85,
          dot: 1,
          score: 0.55
        };
      }
      return null;
    }

    const seats = getAvailableSeats();
    const alignWeight = Math.max(3.2, (cfg?.alignBias ?? 0.9) * 3.4);
    let best = null;

    for (const seat of seats) {
      const planar = Math.hypot(seat.x - ps.x, seat.z - ps.z);
      if (planar > 3.2) continue;

      const ty = seat.y + Math.max(0.24, seat.seatY + 0.12);
      const dx = seat.x - eye.x;
      const dy = ty - eye.y;
      const dz = seat.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 3.85) continue;

      const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / (dist || 1);
      if (dot < 0.72) continue;

      // Score stays numerically higher (worse) than NPC talk unless aiming right at the seat (dot >= 0.94)
      const score = dist * 0.94 + (1 - dot) * alignWeight + (dot >= 0.94 ? 0.0 : 0.28);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'rest:' + seat.id,
          isRest: true,
          restAction: 'sit',
          seatId: seat.id,
          name: seat.name,
          label: seat.name,
          prompt: seat.prompt,
          x: seat.x,
          y: ty,
          z: seat.z,
          dist,
          dot,
          score
        };
      }
    }

    return best;
  }

  function interact(target) {
    if (disposed || !target || !target.isRest) return null;
    if (ctx.doc && (!interactionAllowed(null, ctx.doc) || storyBusy(ctx.doc))) return null;
    if (target.restAction === 'toast' && active && currentSeat?.id === 'feast-seat') {
      if (toastCooldown > 0) return null;
      return triggerFeastToast(true);
    }
    if (target.restAction === 'sit' && !active) {
      return sitAt(target.seatId);
    }
    return null;
  }

  function attachKeyListeners(win) {
    if (!win?.addEventListener) return;
    if (cleanupListeners) cleanupListeners();

    const onKeyDown = (e) => {
      if (disposed) return;
      const doc = ctx.doc;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const tgt = e.target;
      if (tgt && (tgt.isContentEditable || tgt.closest?.(CONTROL_SELECTOR))) return;
      if ((doc && (mysteryUiPaused(doc) || doc.body?.classList?.contains?.('god-flight'))) || ctx.player?.state?.godFlight) return;

      if (active && EXIT_KEYS.has(e.code)) {
        if (e.code === 'Escape') e.preventDefault?.();
        standUp(false);
        return;
      }

      // Fallback KeyE handler only if interaction.js did not already consume KeyE
      if (e.code === 'KeyE' && !e.repeat && !e.defaultPrevented && sitKeyCooldown <= 0) {
        const candidate = pickTarget(ctx.camera);
        if (candidate?.isRest) {
          const res = interact(candidate);
          if (res) e.preventDefault?.();
        }
      }
    };

    win.addEventListener('keydown', onKeyDown);
    cleanupListeners = () => {
      win.removeEventListener('keydown', onKeyDown);
      cleanupListeners = null;
    };
  }

  function wrapMysteries(m) {
    if (!m || m._restWrapped) return;
    m._restWrapped = true;
    const prevPick = typeof m.pickTarget === 'function' ? m.pickTarget.bind(m) : null;
    const prevInteract = typeof m.interact === 'function' ? m.interact.bind(m) : null;
    const prevHide = typeof m.hide === 'function' ? m.hide.bind(m) : null;

    m.pickTarget = function (camera, cfg) {
      const base = prevPick ? prevPick(camera, cfg) : null;
      const own = pickTarget(camera, cfg);
      if (!base) return own;
      if (!own) return base;
      return own.score < base.score ? own : base;
    };

    m.interact = function (target) {
      if (target?.isRest) return interact(target);
      return prevInteract ? prevInteract(target) : null;
    };

    m.hide = function () {
      hideNote();
      return prevHide ? prevHide() : undefined;
    };
  }

  function bind(nextCtx = {}) {
    if (disposed) return api;
    for (const key of [
      'world', 'field', 'player', 'avatar', 'camera', 'sound', 'sky',
      'blockers', 'hospitalityFeast', 'leisureGrove', 'qinHanCompletion',
      'valleyBorderlands', 'outerWilds', 'deepHollows', 'mysteries', 'doc', 'win'
    ]) {
      if (nextCtx[key] !== undefined && nextCtx[key] !== null) {
        ctx[key] = nextCtx[key];
      }
    }
    rebuildSeats();
    wrapMysteries(ctx.mysteries);
    attachKeyListeners(ctx.win);
    return api;
  }

  function update(dt, elapsed, sky, playerState, camera) {
    if (disposed) return;
    if (sky) ctx.sky = sky;
    const doc = ctx.doc;
    if (doc && mysteryUiPaused(doc)) {
      hideNote();
      return;
    }

    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.05);

    if (toastCooldown > 0) toastCooldown = Math.max(0, toastCooldown - step);
    if (sitKeyCooldown > 0) sitKeyCooldown = Math.max(0, sitKeyCooldown - step);

    if (noteActive) {
      if (doc && storyBusy(doc)) {
        hideNote();
      } else if (noteTimer > 0) {
        noteTimer = Math.max(0, noteTimer - step);
        if (noteTimer <= 0) hideNote();
      }
    }

    const ps = playerState || ctx.player?.state;
    const cam = camera || ctx.camera;
    if (!ps) return;

    if (active && currentSeat) {
      // Auto-release if bonfire feast ended (e.g. switched to daytime or rain) or player boarded skiff
      if (ps.aboardSkiff || (currentSeat.id === 'bonfire-mat' && !resolveBonfireSeat())) {
        standUp(true);
        return;
      }
      if (sitKeyCooldown <= 0 && Math.hypot(ps.touchMoveX || 0, ps.touchMoveZ || 0) > 0.25) {
        standUp(false);
        return;
      }
      // Detect external dev teleport (> 3.5m from seat, ignoring ~0.7m barrier.resolve stool push)
      if (Math.hypot(ps.x - syncedPos.x, ps.z - syncedPos.z) > 3.5) {
        active = false;
        currentSeat = null;
        sitProgress = 0;
        ps.seated = false;
        ps.seatId = null;
        if (ctx.avatar?.state) {
          ctx.avatar.state.sitAmount = 0;
          ctx.avatar.state.seatOffsetY = 0;
        }
        return;
      }

      sitProgress = Math.min(1, sitProgress + step / 0.35);
      const ease = smooth01(sitProgress);

      const curX = lerp(originPos.x, currentSeat.x, ease);
      const curY = lerp(originPos.y, currentSeat.y, ease);
      const curZ = lerp(originPos.z, currentSeat.z, ease);
      syncedPos.x = curX;
      syncedPos.y = curY;
      syncedPos.z = curZ;

      ps.x = curX;
      ps.y = curY;
      ps.z = curZ;
      ps.vx = 0;
      ps.vz = 0;
      ps.speed = 0;
      ps.still = true;
      ps.seated = true;

      // Apply decaying initial aim delta without locking mouse freedom
      if (Math.abs(aimRemYaw) > 0.0005 || Math.abs(aimRemPitch) > 0.0005) {
        const k = 1 - Math.exp(-8.5 * step);
        const dYaw = aimRemYaw * k;
        const dPitch = aimRemPitch * k;
        ps.yaw = (ps.yaw || 0) + dYaw;
        ps.pitch = Math.max(-1.2, Math.min(1.2, (ps.pitch || 0) + dPitch));
        if (Number.isFinite(ps.targetYaw)) ps.targetYaw += dYaw;
        if (Number.isFinite(ps.targetPitch)) ps.targetPitch = Math.max(-1.2, Math.min(1.2, ps.targetPitch + dPitch));
        aimRemYaw -= dYaw;
        aimRemPitch -= dPitch;
      }

      const standEyeY = originPos.y + (ps.eyeHeight || 1.65);
      const seatedEyeY = currentSeat.y + currentSeat.seatY + 0.78;
      if (cam) {
        if (ps.view === 'third') {
          ctx.player?.syncCamera?.(cam);
          cam.position.y -= ease * Math.max(0.22, (standEyeY - seatedEyeY) * 0.55);
        } else {
          cam.position.set(curX, lerp(standEyeY, seatedEyeY, ease), curZ);
          cam.rotation?.set?.(ps.pitch || 0, ps.yaw || 0, 0, 'YXZ');
        }
      }

      if (ctx.avatar?.state) {
        ctx.avatar.state.sitAmount = ease;
        ctx.avatar.state.seatOffsetY = currentSeat.seatY;
      }
      ctx.avatar?.update?.(0, elapsed, ps);
    } else if (sitProgress > 0) {
      sitProgress = Math.max(0, sitProgress - step / 0.24);
      const ease = smooth01(sitProgress);
      if (cam && ps.view !== 'third') {
        cam.position.x = ps.x + exitOffset.x * ease;
        cam.position.y = ps.y + (ps.eyeHeight || 1.65) + exitOffset.y * ease;
        cam.position.z = ps.z + exitOffset.z * ease;
      }
      if (ctx.avatar?.state) {
        ctx.avatar.state.sitAmount = ease;
        if (sitProgress <= 0) ctx.avatar.state.seatOffsetY = 0;
      }
      if (sitProgress <= 0) {
        exitOffset = { x: 0, y: 0, z: 0 };
      }
    }
  }

  function getStats() {
    const seats = getAvailableSeats();
    return {
      built: seats.length > 0,
      active,
      seatId: currentSeat?.id || null,
      sitProgress: Math.round(sitProgress * 1000) / 1000,
      toastCount,
      availableSeats: seats.map(s => s.id),
      lastAction,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    standUp(true);
    hideNote();
    if (cleanupListeners) cleanupListeners();
  }

  rebuildSeats();
  if (ctx.mysteries) wrapMysteries(ctx.mysteries);
  if (ctx.win) attachKeyListeners(ctx.win);

  const api = {
    bind,
    pickTarget,
    interact,
    sitAt,
    standUp,
    update,
    getSeats: () => getAvailableSeats(),
    getState: () => ({
      active,
      seat: currentSeat ? { ...currentSeat } : null,
      sitProgress,
      toastCount,
      lastAction
    }),
    getStats,
    dispose,
    get active() { return active; },
    get currentSeat() { return currentSeat ? { ...currentSeat } : null; },
    get currentSeatId() { return currentSeat?.id || null; },
    get sitProgress() { return sitProgress; }
  };

  return api;
}
