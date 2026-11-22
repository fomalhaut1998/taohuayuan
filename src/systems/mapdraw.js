import { chokeFactor } from '../world/terrain.js';
import oxPlowingCfg from '../data/ox-plowing.json' with { type: 'json' };

// 舆图是一幅画，不是一份数据表：纸、地势、水、田、路、屋、山口都在离屏画布上
// 一次画成底图，打开舆图时只铺底图、再叠标记。
// 取向：北在左、东在上 —— 世界 +z（溪水下游）向右拉长，世界 +x（村东）向上抬；
// 从武陵溪到桃源村正好从右往左读，像一卷手卷。
const TAU = Math.PI * 2;

export function projectionFor(extent, w, h) {
  const z0 = extent.z[0];
  const z1 = extent.z[1];
  const x0 = extent.x[0];
  const x1 = extent.x[1];
  const sx = w / (z1 - z0);
  const sy = h / (x1 - x0);
  return {
    w: w,
    h: h,
    x0: x0,
    x1: x1,
    z0: z0,
    z1: z1,
    sx: sx,
    sy: sy,
    ppm: sx,
    px: function (x, z) { return (z - z0) * sx; },
    py: function (x, z) { return (x1 - x) * sy; }
  };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const c = hexRgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

// 两色相混，得一个实色 —— 实色叠不上色，山才不像玻璃
function mix(a, b, t) {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- 纸 ----------
function drawPaper(ctx, proj, cfg, rand) {
  const w = proj.w;
  const h = proj.h;
  const pal = cfg.palette;
  const areaK = (w * h) / (1800 * 750);

  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, w, h);

  // 陈年茶渍：边缘化开的几团暖黄
  for (let i = 0; i < cfg.paper.stain; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = Math.min(w, h) * (0.42 + rand() * 0.75);
    const g = ctx.createRadialGradient(cx, cy, r * 0.04, cx, cy, r);
    g.addColorStop(0, rgba(pal.paperWarm, 0.2 + rand() * 0.1));
    g.addColorStop(0.55, rgba(pal.paperWarm, 0.07));
    g.addColorStop(1, rgba(pal.paperWarm, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
  }

  // 四边压一点淡墨，纸才有厚度
  const edge = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
  edge.addColorStop(0, rgba(pal.ink, 0));
  edge.addColorStop(1, rgba(pal.ink, 0.07));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);

  // 麻点
  ctx.fillStyle = rgba(pal.ink, 0.05);
  const dots = Math.round(cfg.paper.grain * areaK);
  for (let i = 0; i < dots; i++) {
    const s = 0.5 + rand() * 1.1;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }

  // 纸纤维：合为单路径描边，既保持随机序列一致又显著减少首开重绘开销
  ctx.strokeStyle = rgba(pal.ink, 0.03);
  ctx.lineWidth = 0.6;
  const fibers = Math.round(cfg.paper.fiber * areaK);
  ctx.beginPath();
  for (let i = 0; i < fibers; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = 5 + rand() * 20;
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rand() - 0.5) * 3.2);
  }
  ctx.stroke();
}

const FIELD_CACHE = new WeakMap();
function getFieldBucket(field) {
  if (!field || (typeof field !== 'object' && typeof field !== 'function')) return null;
  let bucket = FIELD_CACHE.get(field);
  if (!bucket) {
    bucket = new Map();
    FIELD_CACHE.set(field, bucket);
  }
  return bucket;
}

function isInSouthCliffBand(wx, wz, cl, cfg, innerPad = 10, outerPad = 28) {
  if (!cl) return false;
  const dx = wx - cl.center[0];
  const dz = wz - cl.center[1];
  const dist = Math.hypot(dx, dz);
  const inner = cfg && cfg.wall && cfg.wall.inner != null ? cfg.wall.inner : 34;
  const peak = cfg && cfg.wall && cfg.wall.peak != null ? cfg.wall.peak : 30;
  if (dist < cl.radius - inner - innerPad || dist > cl.radius + peak + outerPad) return false;
  const ang = Math.atan2(dz, dx);
  return ang >= cl.arcFrom - 0.10 && ang <= cl.arcTo + 0.10;
}

// ---------- 地势：低处一层淡青，高处压成青灰 ----------
function drawRelief(ctx, proj, cfg, field, world) {
  const r = cfg.relief;
  const gw = Math.max(2, Math.round((proj.z1 - proj.z0) / r.step));
  const gh = Math.max(2, Math.round((proj.x1 - proj.x0) / r.step));
  const off = document.createElement('canvas');
  off.width = gw;
  off.height = gh;
  const ictx = off.getContext('2d');
  const imgData = ictx.createImageData(gw, gh);
  const data = imgData.data;
  const lo = hexRgb(cfg.palette.field);
  const hi = hexRgb(cfg.palette.mountain);
  const ink = hexRgb(cfg.palette.ink);
  const hAt = function (x, z) { return field.sample(x, z); };
  // 崖圈那一带的山体由 drawWall 自己画（不透光的石面），
  // 只压掉南崖扇环带，保留东西北外山与武陵山麓的真实地势晕染。
  const cl = world && world.cliff;
  const bucket = getFieldBucket(field);
  const key = 'relief-v2:' + gw + ':' + gh + ':' + proj.x0 + ':' + proj.x1 + ':' + proj.z0 + ':' + proj.z1 + ':' + r.step;
  let cached = bucket ? bucket.get(key) : null;
  if (!cached) {
    const count = gw * gh;
    const tArr = new Float32Array(count);
    const shadeArr = new Float32Array(count);
    const aArr = new Uint8ClampedArray(count);
    const gentleFrom = Math.min(r.slopeFrom, 0.14);
    const elevAlpha = Math.max(r.alpha, 0.13);
    for (let j = 0; j < gh; j++) {
      const x = proj.x1 - (j + 0.5) * r.step;
      for (let i = 0; i < gw; i++) {
        const z = proj.z0 + (i + 0.5) * r.step;
        const hv = hAt(x, z);
        // 只给隆起的地方上色：谷地、村中盆地都留纸，外山高坡则现青灰层次
        const t = Math.min(1, Math.max(0, (hv - r.low) / (r.high - r.low)));
        const hx = hAt(x + r.step, z);
        const hz = hAt(x, z + r.step);
        const gx = (hx - hv) / r.step;
        const gz = (hz - hv) / r.step;
        const slope = Math.hypot(gx, gz);
        const steep = Math.min(1, Math.max(0, (slope - r.slopeFrom) / r.slopeTo));
        const w = t * t * (3 - 2 * t);
        const gentleSteep = Math.min(1, Math.max(0, (slope - gentleFrom) / 0.85)) * (0.25 + 0.75 * w);
        const effSteep = Math.max(steep, gentleSteep * 0.65);
        // 光从西北来：x 增（东）与 z 增（北）方向为迎光面
        const lit = Math.min(1, Math.max(0, 0.5 + (gx * 0.72 + gz * 0.52) * 0.9));
        let shade = effSteep * (0.28 + 0.72 * (1 - lit));
        const mask = isInSouthCliffBand(x, z, cl, cfg, 10, 26) ? 0.15 : 1;
        shade *= mask;
        const a = Math.min(1, (elevAlpha * w + r.shadeAlpha * shade) * (mask < 1 ? 0.45 : 1));
        const idx = j * gw + i;
        tArr[idx] = t;
        shadeArr[idx] = shade;
        aArr[idx] = Math.round(255 * a);
      }
    }
    cached = { tArr, shadeArr, aArr };
    if (bucket) bucket.set(key, cached);
  }
  const { tArr, shadeArr, aArr } = cached;
  for (let idx = 0; idx < tArr.length; idx++) {
    const t = tArr[idx];
    const shade = shadeArr[idx];
    const o = idx * 4;
    data[o] = lo[0] + (hi[0] - lo[0]) * t;
    data[o + 1] = lo[1] + (hi[1] - lo[1]) * t;
    data[o + 2] = lo[2] + (hi[2] - lo[2]) * t;
    // 陡坡的墨色压进同一个像素，免得另起一层把纸洗灰
    if (shade > 0.01) {
      const k = shade * r.shadeInk;
      data[o] = data[o] * (1 - k) + ink[0] * k;
      data[o + 1] = data[o + 1] * (1 - k) + ink[1] * k;
      data[o + 2] = data[o + 2] * (1 - k) + ink[2] * k;
    }
    data[o + 3] = aArr[idx];
  }
  ictx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, proj.w, proj.h);
  ctx.restore();
}

// ---------- 等高线：只在有高差的地方落笔 ----------
// 山不是画出来的一条带，是地势自己长出来的：每隔几米一根线，
// 每题第三根加重，山才有层，也才看得出坡往哪边落。
function drawContours(ctx, proj, cfg, field, world) {
  const c = cfg.relief.contour;
  if (!c) return;
  const u = proj.w / cfg.design;
  const step = 2.5;
  const gw = Math.max(2, Math.round((proj.z1 - proj.z0) / step));
  const gh = Math.max(2, Math.round((proj.x1 - proj.x0) / step));
  const gx = gw + 1;
  const xs = new Float32Array(gw + 1);
  const ys = new Float32Array(gh + 1);
  for (let i = 0; i <= gw; i++) xs[i] = proj.px(0, proj.z0 + (i * (proj.z1 - proj.z0)) / gw);
  for (let j = 0; j <= gh; j++) ys[j] = proj.py(proj.x1 - (j * (proj.x1 - proj.x0)) / gh, 0);
  const bucket = getFieldBucket(field);
  const key = 'contour:' + gw + ':' + gh + ':' + proj.x0 + ':' + proj.x1 + ':' + proj.z0 + ':' + proj.z1 + ':' + step;
  let cached = bucket ? bucket.get(key) : null;
  if (!cached) {
    const hs = new Float32Array(gx * (gh + 1));
    let hmin = Infinity;
    let hmax = -Infinity;
    for (let j = 0; j <= gh; j++) {
      const x = proj.x1 - (j * (proj.x1 - proj.x0)) / gh;
      for (let i = 0; i <= gw; i++) {
        const z = proj.z0 + (i * (proj.z1 - proj.z0)) / gw;
        const hv = field.sample(x, z);
        hs[j * gx + i] = hv;
        if (hv < hmin) hmin = hv;
        if (hv > hmax) hmax = hv;
      }
    }
    cached = { hs, hmin, hmax };
    if (bucket) bucket.set(key, cached);
  }
  const { hs, hmin, hmax } = cached;
  const from = Math.max(c.from, Math.ceil(hmin / c.step) * c.step);
  const to = Math.min(c.to, hmax);
  if (to <= from) return;
  // 南崖石壁带内部不画等高线，其余外野丘壑与武陵两麓皆循地形落笔。
  const cl = world && world.cliff;
  const seg = [0, 0, 0, 0, 0, 0, 0, 0];
  ctx.save();
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    const major = pass === 1;
    const path = new Path2D();
    for (let lv = from; lv <= to + 1e-6; lv += c.step) {
      const isMajor = Math.abs(lv % (c.step * 3)) < 1e-6;
      if (isMajor !== major) continue;
      for (let j = 0; j < gh; j++) {
        const y0 = ys[j];
        const y1 = ys[j + 1];
        const r0 = j * gx;
        const r1 = r0 + gx;
        for (let i = 0; i < gw; i++) {
          const h0 = hs[r0 + i];
          const h1 = hs[r0 + i + 1];
          const h2 = hs[r1 + i + 1];
          const h3 = hs[r1 + i];
          const up0 = h0 >= lv;
          const up1 = h1 >= lv;
          const up2 = h2 >= lv;
          const up3 = h3 >= lv;
          if (up0 === up1 && up1 === up2 && up2 === up3) continue;
          if (cl) {
            const wx = proj.x1 - ((j + 0.5) * (proj.x1 - proj.x0)) / gh;
            const wz = proj.z0 + ((i + 0.5) * (proj.z1 - proj.z0)) / gw;
            if (isInSouthCliffBand(wx, wz, cl, cfg, 12, 32)) continue;
          }
          const x0 = xs[i];
          const x1 = xs[i + 1];
          let n = 0;
          if (up0 !== up1) {
            seg[n * 2] = x0 + (x1 - x0) * ((lv - h0) / (h1 - h0));
            seg[n * 2 + 1] = y0;
            n++;
          }
          if (up1 !== up2) {
            seg[n * 2] = x1;
            seg[n * 2 + 1] = y0 + (y1 - y0) * ((lv - h1) / (h2 - h1));
            n++;
          }
          if (up2 !== up3) {
            seg[n * 2] = x1 + (x0 - x1) * ((lv - h2) / (h3 - h2));
            seg[n * 2 + 1] = y1;
            n++;
          }
          if (up3 !== up0) {
            seg[n * 2] = x0;
            seg[n * 2 + 1] = y1 + (y0 - y1) * ((lv - h3) / (h0 - h3));
            n++;
          }
          if (n === 2) {
            path.moveTo(seg[0], seg[1]);
            path.lineTo(seg[2], seg[3]);
          } else if (n === 4) {
            path.moveTo(seg[0], seg[1]);
            path.lineTo(seg[2], seg[3]);
            path.moveTo(seg[4], seg[5]);
            path.lineTo(seg[6], seg[7]);
          }
        }
      }
    }
    ctx.strokeStyle = rgba(cfg.palette.ink, major ? c.majorAlpha : c.alpha);
    ctx.lineWidth = (major ? 1.1 : 0.55) * u;
    ctx.stroke(path);
  }
  ctx.restore();
}


// ---------- 通用小件 ----------
// 带朝向的方物（屋、院、畦、箕）都先落进自己的 (u,v) 架子再投影：
// u 沿面宽、v 沿进深，v 正向朝门口。
function frameOf(proj, cx, cz, rot) {
  const a = rot || 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return function (u, v) {
    const wx = cx + u * ca + v * sa;
    const wz = cz - u * sa + v * ca;
    return [proj.px(wx, wz), proj.py(wx, wz)];
  };
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function strokeLine(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function rectFrame(sp, u0, v0, u1, v1) {
  return [sp(u0, v0), sp(u1, v0), sp(u1, v1), sp(u0, v1)];
}

function mixRgba(a, b, t, alpha) {
  const m = mix(a, b, t);
  return 'rgba(' + m.slice(4, -1) + ',' + alpha + ')';
}

// Catmull-Rom：把主路的折点抻成一条不拐硬角的土路
function smoothWorld(pts, segs) {
  const out = [];
  if (!pts || pts.length < 2) return pts || [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 屏幕坐标上的偏移线：给路面画车辙、给河画内缘
function offsetScreen(scr, off) {
  const out = [];
  for (let i = 0; i < scr.length; i++) {
    const a = scr[Math.max(0, i - 1)];
    const b = scr[Math.min(scr.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    out.push([scr[i][0] + ty * off, scr[i][1] - tx * off]);
  }
  return out;
}

// 一条有宽度的带子，宽度可沿长度收口（支路从路边插到门口会收窄）
function taperedBand(scr, halfPx, taper) {
  const left = [];
  const right = [];
  for (let i = 0; i < scr.length; i++) {
    const a = scr[Math.max(0, i - 1)];
    const b = scr[Math.min(scr.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const hw = halfPx * (1 - (i / Math.max(1, scr.length - 1)) * (taper || 0));
    left.push([scr[i][0] + ty * hw, scr[i][1] - tx * hw]);
    right.push([scr[i][0] - ty * hw, scr[i][1] + tx * hw]);
  }
  return left.concat(right.reverse());
}

// 折线上按弧长取点（路口摆人就靠它，不另编坐标）
function pointAlong(pts, t, proj) {
  let total = 0;
  const seg = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    seg.push(d);
    total += d;
  }
  let want = total * Math.max(0, Math.min(1, t));
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const f = seg[i] > 0 ? want / seg[i] : 0;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
      const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      let nx = -(pts[i + 1][1] - pts[i][1]);
      let nz = pts[i + 1][0] - pts[i][0];
      const l = Math.hypot(nx, nz) || 1;
      return { x: x, z: z, nx: nx / l, nz: nz / l, sx: proj.px(x, z), sy: proj.py(x, z) };
    }
    want -= seg[i];
  }
  const p = pts[0];
  return { x: p[0], z: p[1], nx: 0, nz: 1, sx: proj.px(p[0], p[1]), sy: proj.py(p[0], p[1]) };
}

// ---------- 草坡：大片留白上的一层呼吸 ----------
function drawMeadow(ctx, proj, cfg, src, rand, world) {
  const u = proj.w / cfg.design;
  const pal = cfg.palette;
  const d = cfg.detail || {};
  const areaK = (proj.w * proj.h) / (1800 * 750);
  const cl = world && world.cliff;

  // 水洗淡绿与青岚：几团化开的坡地，给盆地与外山缓坡添一层高低色阶
  const washes = Math.round(34 * Math.max(1, areaK));
  for (let i = 0; i < washes; i++) {
    const z = proj.z0 + rand() * (proj.z1 - proj.z0);
    const x = proj.x0 + rand() * (proj.x1 - proj.x0);
    const hv = src.field.sample(x, z);
    if (hv < 0.25 || hv > 19 || isInSouthCliffBand(x, z, cl, cfg, 8, 28)) continue;
    const cx = proj.px(x, z);
    const cy = proj.py(x, z);
    const r = (65 + rand() * 125) * u;
    const washHex = hv > 8.5 ? pal.mountain : pal.field;
    const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
    g.addColorStop(0, rgba(washHex, hv > 8.5 ? 0.14 : 0.15));
    g.addColorStop(0.62, rgba(washHex, 0.055));
    g.addColorStop(1, rgba(washHex, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
  }

  // 草丛：三笔一撮，延伸至外野缓坡
  const tufts = Math.round((d.grass || 0) * areaK);
  ctx.strokeStyle = rgba(pal.field, 0.18);
  ctx.lineWidth = 0.65 * u;
  ctx.beginPath();
  for (let i = 0; i < tufts; i++) {
    const z = proj.z0 + rand() * (proj.z1 - proj.z0);
    const x = proj.x0 + rand() * (proj.x1 - proj.x0);
    const hv = src.field.sample(x, z);
    if (hv < 0.25 || hv > 16 || isInSouthCliffBand(x, z, cl, cfg, 8, 28)) continue;
    const sx = proj.px(x, z);
    const sy = proj.py(x, z);
    const s = (1.0 + rand() * 1.15) * u;
    const lean = (rand() - 0.5) * 0.7 * s;
    ctx.moveTo(sx, sy + s * 0.8);
    ctx.lineTo(sx + lean, sy - s * 0.25);
    ctx.moveTo(sx, sy + s * 0.8);
    ctx.lineTo(sx - s * 0.6 + lean * 0.4, sy + s * 0.05);
    ctx.moveTo(sx, sy + s * 0.8);
    ctx.lineTo(sx + s * 0.52 + lean * 0.8, sy + s * 0.2);
  }
  ctx.stroke();

  // 野花：纸上点几星暖色，别点成花海
  const flowers = Math.round((d.flower || 0) * areaK);
  for (let i = 0; i < flowers; i++) {
    const z = proj.z0 + rand() * (proj.z1 - proj.z0);
    const x = proj.x0 + rand() * (proj.x1 - proj.x0);
    const hv = src.field.sample(x, z);
    if (hv < 0.25 || hv > 16 || isInSouthCliffBand(x, z, cl, cfg, 8, 28)) continue;
    const sx = proj.px(x, z);
    const sy = proj.py(x, z);
    ctx.beginPath();
    ctx.arc(sx, sy, (0.7 + rand() * 0.5) * u, 0, TAU);
    ctx.fillStyle = rand() < 0.55 ? mixRgba(pal.paper, pal.road, 0.55, 0.52) : rgba(pal.paper, 0.62);
    ctx.fill();
  }

  // 石子：路边与山坡散几点灰
  const stones = Math.round((d.stone || 0) * areaK);
  ctx.fillStyle = rgba(pal.stone, 0.32);
  for (let i = 0; i < stones; i++) {
    const z = proj.z0 + rand() * (proj.z1 - proj.z0);
    const x = proj.x0 + rand() * (proj.x1 - proj.x0);
    const hv = src.field.sample(x, z);
    if (hv < 0.25 || hv > 16 || isInSouthCliffBand(x, z, cl, cfg, 8, 28)) continue;
    const sx = proj.px(x, z);
    const sy = proj.py(x, z);
    const r = (1.0 + rand() * 1.5) * u;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.62, rand() * 3, 0, TAU);
    ctx.fill();
  }
}

// ---------- 桃花：先一层雾，再一层冠，最后点花心 ----------
// 树是点出来的：桃林落粉点、外山落苍青点。整片铺雾会把河与纸都染粉，
// 一点一点的树冠反而更耐看，也把林子边缘交代清楚。
function drawGroves(ctx, proj, cfg, spots, rand, field, world) {
  if (!spots || !spots.length) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const grove = cfg.grove || {};
  const gx = grove.x == null ? 16 : grove.x;
  const gz = grove.z == null ? 120 : grove.z;
  const gr2 = (grove.radius == null ? 118 : grove.radius) ** 2;
  const cl = world && world.cliff;
  const pad = 30;
  const TAU2 = Math.PI * 2;
  // 1) 林子深处一层极淡的底，只让成片处有一点体量
  const CELL = 14;
  const cells = new Map();
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    if ((sp[0] - gx) ** 2 + (sp[2] - gz) ** 2 > gr2) continue;
    const k = Math.floor(sp[0] / CELL) + ':' + Math.floor(sp[2] / CELL);
    const c = cells.get(k);
    if (c) { c.n++; c.x += sp[0]; c.z += sp[2]; }
    else cells.set(k, { n: 1, x: sp[0], z: sp[2] });
  }
  cells.forEach(function (c) {
    if (c.n < 6) return;
    const px = proj.px(c.x / c.n, c.z / c.n);
    const py = proj.py(c.x / c.n, c.z / c.n);
    if (px < -pad || py < -pad || px > proj.w + pad || py > proj.h + pad) return;
    const rr = CELL * (0.5 + rand() * 0.35);
    ctx.beginPath();
    ctx.ellipse(px, py, rr * proj.sx, rr * proj.sy, rand() * 0.7, 0, TAU2);
    ctx.fillStyle = rgba(pal.peach, 0.02 + Math.min(0.03, c.n * 0.0022));
    ctx.fill();
  });
  // 2) 一棵树 = 一小撮冠：2-4 粒，深浅各一，才不是撒糖
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const px = proj.px(sp[0], sp[2]);
    const py = proj.py(sp[0], sp[2]);
    if (px < -pad || py < -pad || px > proj.w + pad || py > proj.h + pad) continue;
    const isPeach = (sp[0] - gx) ** 2 + (sp[2] - gz) ** 2 < gr2;
    if (!isPeach && isInSouthCliffBand(sp[0], sp[2], cl, cfg, 6, 20)) continue;
    // 冠按米算再乘像素比：桃花林与外山林木成团落墨，才不会像一层散点。
    const m = proj.sx;
    const r0 = isPeach ? (1.5 + rand() * 0.85) * m : (1.05 + rand() * 0.58) * m;
    const nDab = isPeach ? 3 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2);
    for (let k = 0; k < nDab; k++) {
      const a = rand() * TAU2;
      const rad = rand() * r0 * 1.05;
      const ex = px + Math.cos(a) * rad;
      const ey = py + Math.sin(a) * rad;
      const rr = r0 * (0.5 + rand() * 0.5);
      ctx.beginPath();
      ctx.arc(ex, ey, rr, 0, TAU2);
      if (isPeach) {
        ctx.fillStyle = k === 0
          ? mixRgba(pal.peach, pal.peachDeep, 0.42, 0.22 + rand() * 0.12)
          : mixRgba(pal.peach, pal.paper, 0.14, 0.24 + rand() * 0.16);
      } else {
        ctx.fillStyle = k === 0
          ? mixRgba(pal.bamboo, pal.ink, 0.22, 0.22 + rand() * 0.12)
          : mixRgba(pal.field, pal.bamboo, 0.45, 0.20 + rand() * 0.12);
      }
      ctx.fill();
    }
    // 树干：一点墨，树才落地
    if (rand() < (isPeach ? 0.55 : 0.45)) {
      ctx.beginPath();
      ctx.arc(px + (rand() - 0.5) * 2.4, py + (rand() - 0.5) * 2.4, (isPeach ? 0.7 : 0.55) + rand() * 0.45, 0, TAU2);
      ctx.fillStyle = rgba(pal.ink, isPeach ? 0.14 : 0.16);
      ctx.fill();
    }
  }
}

// ---------- 溪：与 Three 里同一条法线、同一套收束 ----------
function drawRiver(ctx, proj, cfg, world, spine) {
  if (!spine || spine.length < 2) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const d = cfg.detail || {};
  const s = world.stream;
  const n = spine.length - 1;
  const left = [];
  const right = [];
  const mids = [];
  for (let i = 0; i <= n; i++) {
    const p = spine[i];
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(n, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = tz;
    const nz = -tx;
    const t = i / n;
    // 舆图上的河比真河窄一点：河道一宽，村子就成了河边的一条小注脚
    let half = (s.halfWidth * (cfg.river.drawScale == null ? 1 : cfg.river.drawScale) + Math.sin(t * 21.7) * s.edgeWobble) * chokeFactor(world.terrain, p[0], p[1]);
    // 到山口这一端收成一道细水，不要平切
    const taper = Math.min(1, (n - i) / 8);
    half *= 0.22 + 0.78 * taper;
    left.push([proj.px(p[0] + nx * half, p[1] + nz * half), proj.py(p[0] + nx * half, p[1] + nz * half)]);
    right.push([proj.px(p[0] - nx * half, p[1] - nz * half), proj.py(p[0] - nx * half, p[1] - nz * half)]);
    mids.push({ nx: nx, nz: nz, half: half, x: p[0], z: p[1] });
  }
  // 近岸的浅滩：水边一圈更亮的青，压住纸的毛边
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const m = mids[i];
    const x = proj.px(m.x + m.nx * m.half * 1.16, m.z + m.nz * m.half * 1.16);
    const y = proj.py(m.x + m.nx * m.half * 1.16, m.z + m.nz * m.half * 1.16);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const m = mids[i];
    const x = proj.px(m.x - m.nx * m.half * 1.16, m.z - m.nz * m.half * 1.16);
    const y = proj.py(m.x - m.nx * m.half * 1.16, m.z - m.nz * m.half * 1.16);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(pal.water, 0.16);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = rgba(pal.water, cfg.river.fill);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.waterEdge, cfg.river.edge);
  ctx.lineWidth = 1.3 * u;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 岸线内缘：一道更浅的亮边，水才有边
  ctx.strokeStyle = rgba(pal.waterLine, 0.28);
  ctx.lineWidth = 0.9 * u;
  ctx.stroke();

  // 鱼鳞纹：一排压一排的半弧。纸上的水靠这个才活，光抹一层青只是布
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.clip();
  const rowM = 6.4;
  const scM = 4.2;
  let acc = 0;
  let rowIdx = 0;
  for (let i = 1; i <= n; i++) {
    const m0 = mids[i - 1];
    const m1 = mids[i];
    acc += Math.hypot(m1.x - m0.x, m1.z - m0.z);
    if (acc < rowM) continue;
    acc = 0;
    const hw = m1.half * 0.94;
    if (hw < 1.6) continue;
    const halfScr = hw * proj.sx;
    const stepScr = scM * proj.sx;
    const nSc = Math.floor((halfScr * 2) / stepScr);
    const phase = (rowIdx % 2) * stepScr * 0.5;
    ctx.beginPath();
    for (let j = 0; j <= nSc; j++) {
      const off = -halfScr + phase + j * stepScr;
      if (Math.abs(off) > halfScr - stepScr * 0.25) continue;
      const cxw = m1.x + m1.nx * (off / proj.sx);
      const czw = m1.z + m1.nz * (off / proj.sx);
      const cx = proj.px(cxw, czw);
      const cy = proj.py(cxw, czw);
      const rw = stepScr * 0.5;
      ctx.moveTo(cx - rw, cy);
      ctx.quadraticCurveTo(cx, cy + rw * 0.55, cx + rw, cy);
    }
    ctx.strokeStyle = rgba(pal.waterEdge, 0.14);
    ctx.lineWidth = 0.75 * u;
    ctx.stroke();
    rowIdx++;
  }
  ctx.restore();

  // 水纹：两条顺着岸走的细线
  for (let k = -1; k <= 1; k += 2) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const m = mids[i];
      const off = m.half * 0.46 * k;
      const x = proj.px(m.x + m.nx * off, m.z + m.nz * off);
      const y = proj.py(m.x + m.nx * off, m.z + m.nz * off);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(pal.waterEdge, cfg.river.flow);
    ctx.lineWidth = 0.8 * u;
    ctx.stroke();
  }

  // 几道短水纹：纸上画水，不能只有两条平行的线
  const rand = lcg(5521);
  for (let i = 0; i < 26; i++) {
    const t = rand();
    const k = Math.floor(t * n);
    const m = mids[k];
    if (!m || m.half < 1.2) continue;
    const off = (rand() - 0.5) * m.half * 1.2;
    const x = proj.px(m.x + m.nx * off, m.z + m.nz * off);
    const y = proj.py(m.x + m.nx * off, m.z + m.nz * off);
    const len = (2.4 + rand() * 4) * u;
    ctx.beginPath();
    ctx.moveTo(x - len * 0.5, y);
    ctx.quadraticCurveTo(x, y - 0.9 * u, x + len * 0.5, y);
    ctx.strokeStyle = rgba(pal.waterEdge, 0.16);
    ctx.lineWidth = 0.7 * u;
    ctx.stroke();
  }

  // 岸上的芦苇：贴着水边一丛丛的细笔
  const reeds = Math.round((d.reed || 0) * ((proj.w * proj.h) / (1800 * 750)));
  ctx.strokeStyle = rgba(pal.bamboo, 0.34);
  ctx.lineWidth = 0.65 * u;
  ctx.beginPath();
  for (let i = 0; i < reeds; i++) {
    const t = rand();
    const k = Math.min(n, Math.max(1, Math.round(t * n)));
    const m = mids[k];
    if (!m || m.half < 2) continue;
    const side = rand() < 0.5 ? -1 : 1;
    const off = m.half * (1.06 + rand() * 0.24) * side;
    const x = proj.px(m.x + m.nx * off, m.z + m.nz * off);
    const y = proj.py(m.x + m.nx * off, m.z + m.nz * off);
    const h = (2.2 + rand() * 2.2) * u;
    for (let q = 0; q < 3; q++) {
      const bx = x + (rand() - 0.5) * 3 * u;
      ctx.moveTo(bx, y + 0.6 * u);
      ctx.lineTo(bx + (rand() - 0.5) * 1.6 * u, y - h * (0.7 + rand() * 0.5));
    }
  }
  ctx.stroke();
}

// ---------- 溪上的三条船：就停在世界里那三条的位置 ----------
function drawBoats(ctx, proj, cfg, world) {
  const pal = cfg.palette;
  const u = (proj.w / cfg.design) * 1.55;
  const bs = world.boats;
  if (!bs || !bs.boats) return;
  const L = bs.length || 3.6;
  const W = bs.width || 1.24;
  for (let i = 0; i < bs.boats.length; i++) {
    const b = bs.boats[i];
    const sp = frameOf(proj, b.x, b.z, b.rot || 0);
    const hl = L * 0.5;
    const hw = W * 0.5;
    const p0 = sp(-hl, 0);
    const p1 = sp(-hl * 0.55, -hw);
    const p2 = sp(hl * 0.45, -hw * 0.92);
    const p3 = sp(hl, 0);
    const p4 = sp(hl * 0.45, hw * 0.92);
    const p5 = sp(-hl * 0.55, hw);
    // 船壳
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.quadraticCurveTo(p1[0], p1[1], ((p1[0] + p2[0]) / 2), ((p1[1] + p2[1]) / 2));
    ctx.quadraticCurveTo(((p2[0] + p3[0]) / 2), ((p2[1] + p3[1]) / 2), p3[0], p3[1]);
    ctx.quadraticCurveTo(((p3[0] + p4[0]) / 2), ((p3[1] + p4[1]) / 2), ((p4[0] + p5[0]) / 2), ((p4[1] + p5[1]) / 2));
    ctx.quadraticCurveTo(p5[0], p5[1], p0[0], p0[1]);
    ctx.closePath();
    ctx.fillStyle = rgba(pal.roof, 0.8);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.42);
    ctx.lineWidth = 0.8 * u;
    ctx.stroke();
    // 船篷 / 舱板
    const cp = sp(0, 0);
    ctx.beginPath();
    ctx.ellipse(cp[0], cp[1], (L * 0.19) * proj.sx, (W * 0.3) * proj.sy, -((b.rot || 0) + Math.PI * 0.5), 0, TAU);
    ctx.fillStyle = b.canopy ? rgba(pal.ink, 0.22) : rgba(pal.ink, 0.1);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.3);
    ctx.lineWidth = 0.6 * u;
    ctx.stroke();
    // 系船的木桩
    const mp = sp(-hl - 1.1, W * 0.5);
    ctx.beginPath();
    ctx.arc(mp[0], mp[1], 0.9 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.4);
    ctx.fill();
  }
}

// ---------- 美池：岸线照 3D 的真实岸，荷叶与柳是画的 ----------
function drawPond(ctx, proj, cfg, world, src) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const d = cfg.detail || {};
  const pond = world.terrain && world.terrain.pond;
  if (!pond) return;
  const mapped = src && src.pond;
  const rim = mapped && mapped.rim && mapped.rim.length ? mapped.rim : null;
  const n = rim ? rim.length : 44;
  const avg = (function () {
    if (!rim) return pond.waterRadius || pond.radius;
    let s = 0;
    for (let i = 0; i < rim.length; i++) s += rim[i];
    return s / rim.length;
  })();
  const rand2 = lcg(4242);
  const baseR = pond.waterRadius || pond.radius;
  const fakeRim = [];
  if (!rim) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      fakeRim.push(baseR * (1.02
        + 0.085 * Math.sin(a * 2 + 0.7)
        + 0.055 * Math.sin(a * 3 - 1.3)
        + 0.03 * Math.sin(a * 7 + 2.1)));
    }
  }
  const shoreR = function (i) {
    if (rim) return rim[i % n];
    return fakeRim[i % n];
  };
  function rimPoint(i, scale) {
    const ang = (i / n) * TAU;
    const r = shoreR(i) * (scale || 1);
    return [proj.px(pond.x + Math.cos(ang) * r, pond.z + Math.sin(ang) * r),
            proj.py(pond.x + Math.cos(ang) * r, pond.z + Math.sin(ang) * r)];
  }
  // 岸外的湿土
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = rimPoint(i, 1.13);
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(pal.water, 0.1);
  ctx.fill();
  // 水面
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = rimPoint(i, 1);
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(pal.water, 0.62);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.waterEdge, 0.55);
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  // 水色不套圈：中心偏下一片淡墨，再沿近岸压两笔，像有深有浅
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = rimPoint(i, 0.62);
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(pal.waterEdge, 0.1);
  ctx.fill();
  ctx.restore();
  for (let k = 0; k < 3; k++) {
    const a0 = rand2() * TAU;
    const p0 = rimPoint(Math.floor((a0 / TAU) * n), 0.9);
    const a1 = a0 + 0.5 + rand2() * 0.7;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    for (let t = 0.15; t < 1; t += 0.15) {
      const aa = a0 + (a1 - a0) * t;
      const p = rimPoint(Math.floor((aa / TAU) * n), 0.9 - t * 0.12);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.strokeStyle = rgba(pal.waterEdge, 0.2);
    ctx.lineWidth = 0.7 * u;
    ctx.stroke();
  }

  const rand = lcg(9091);
  // 荷叶与池边实物落位
  const pondPlacements = src && src.pondLife && Array.isArray(src.pondLife.placements) ? src.pondLife.placements : null;
  if (pondPlacements && pondPlacements.length) {
    for (let i = 0; i < pondPlacements.length; i++) {
      const item = pondPlacements[i];
      if (item.target === 'lotus') {
        const x = proj.px(item.x, item.z);
        const y = proj.py(item.x, item.z);
        const r = Math.max(0.45, Math.min(0.95, item.radius || 0.65)) * proj.sx;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = rgba(pal.lotus, 0.56);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.18);
        ctx.lineWidth = 0.5 * u;
        ctx.stroke();
        if (i % 3 === 0) {
          ctx.beginPath();
          ctx.arc(x - r * 0.25, y - r * 0.28, r * 0.34, 0, TAU);
          ctx.fillStyle = rgba(pal.peach, 0.6);
          ctx.fill();
        }
      } else if (item.target === 'laundry-stone' || item.target === 'harvest-tub') {
        const x = proj.px(item.x, item.z);
        const y = proj.py(item.x, item.z);
        const r = (item.target === 'harvest-tub' ? 0.55 : 0.72) * proj.sx;
        ctx.beginPath();
        if (item.target === 'harvest-tub') ctx.arc(x, y, r, 0, TAU);
        else ctx.rect(x - r, y - r * 0.65, r * 2, r * 1.3);
        ctx.fillStyle = rgba(pal.mountainDeep, 0.42);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.36);
        ctx.lineWidth = 0.55 * u;
        ctx.stroke();
      }
    }
  } else {
    const lotus = d.lotus || 8;
    for (let i = 0; i < lotus; i++) {
      const ang = rand() * TAU;
      const rr = avg * (0.18 + rand() * 0.6);
      const x = proj.px(pond.x + Math.cos(ang) * rr, pond.z + Math.sin(ang) * rr);
      const y = proj.py(pond.x + Math.cos(ang) * rr, pond.z + Math.sin(ang) * rr);
      const r = (0.45 + rand() * 0.4) * proj.sx;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = rgba(pal.lotus, 0.5 + rand() * 0.18);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.16);
      ctx.lineWidth = 0.5 * u;
      ctx.stroke();
      if (rand() < 0.4) {
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.32, 0, TAU);
        ctx.fillStyle = rgba(pal.peach, 0.55);
        ctx.fill();
      }
    }
  }

  // 池边芦苇
  for (let i = 0; i < 34; i++) {
    const k = Math.floor(rand() * n);
    const p = rimPoint(k, 1.02 + rand() * 0.2);
    const h = (2.0 + rand() * 2.0) * u;
    ctx.beginPath();
    for (let q = 0; q < 3; q++) {
      const bx = p[0] + (rand() - 0.5) * 3 * u;
      ctx.moveTo(bx, p[1] + 0.6 * u);
      ctx.lineTo(bx + (rand() - 0.5) * 1.8 * u, p[1] - h * (0.7 + rand() * 0.5));
    }
    ctx.strokeStyle = rgba(pal.bamboo, 0.34);
    ctx.lineWidth = 0.65 * u;
    ctx.stroke();
  }

  // 池边两棵柳：冠是垂下来的，和桑树不是一个画法
  const willows = d.willow || [];
  for (let i = 0; i < willows.length; i++) {
    const wx = willows[i][0];
    const wz = willows[i][1];
    const cx = proj.px(wx, wz);
    const cy = proj.py(wx, wz);
    const r = (2.1 + rand() * 0.5) * proj.sx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = rgba(pal.willow, 0.13);
    ctx.fill();
    ctx.beginPath();
    for (let q = 0; q < 9; q++) {
      const a = (q / 9) * TAU;
      const sx = cx + Math.cos(a) * r * 0.55;
      const sy = cy + Math.sin(a) * r * 0.35 - r * 0.2;
      const ex = cx + Math.cos(a) * r * 1.0;
      const ey = cy + Math.sin(a) * r * 0.55 + r * 0.7;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx + Math.cos(a) * r * 0.95, (sy + ey) * 0.5, ex, ey);
    }
    ctx.strokeStyle = rgba(pal.willow, 0.5);
    ctx.lineWidth = 0.7 * u;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - r * 0.1, cy - r * 0.15, 1.3 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.35);
    ctx.fill();
  }
}

// ---------- 良田：一格田是一张垄，不是一块色 ----------
function drawFields(ctx, proj, cfg, world) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const cfgV = world.village;
  if (!cfgV || !cfgV.fields) return;
  const blocks = cfgV.fields.blocks || [];
  const rand = lcg(3355);
  const jit = (a) => (rand() - 0.5) * a;
  // 一条会抖的边：田是人顺着地势开的，直边一眼就是格纸
  function wobblyRect(a0, b0, a1, b1, amp) {
    const q = [];
    const nx = 9;
    const nz = 12;
    for (let i = 0; i < nx; i++) q.push([a0 + ((a1 - a0) * i) / nx, b0 + jit(amp)]);
    for (let i = 0; i < nz; i++) q.push([a1 + jit(amp), b0 + ((b1 - b0) * i) / nz]);
    for (let i = 0; i < nx; i++) q.push([a1 - ((a1 - a0) * i) / nx, b1 + jit(amp)]);
    for (let i = 0; i < nz; i++) q.push([a0 + jit(amp), b1 - ((b1 - b0) * i) / nz]);
    return q;
  }
  // 四条边都抖，四个角再往里啃一口，整块田才不是一张纸
  function organicRect(a0, b0, a1, b1, amp) {
    const q = wobblyRect(a0, b0, a1, b1, amp);
    const idx = [0, 9, 21, 30];
    const cx0 = (a0 + a1) / 2;
    const cy0 = (b0 + b1) / 2;
    for (let k = 0; k < idx.length; k++) {
      const p = q[idx[k]];
      const d = 0.12 + rand() * 0.3;
      q[idx[k]] = [p[0] + (cx0 - p[0]) * d, p[1] + (cy0 - p[1]) * d];
    }
    return q;
  }
  function tracePoly(q) {
    ctx.beginPath();
    for (let i = 0; i < q.length; i++) {
      if (i === 0) ctx.moveTo(q[i][0], q[i][1]);
      else ctx.lineTo(q[i][0], q[i][1]);
    }
    ctx.closePath();
  }
  // 不等宽的分畦：一块大一块小，才不像格纸
  function fracs(n) {
    const out = [0];
    const raw = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.62 + rand() * 0.76;
      raw.push(w);
      sum += w;
    }
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += raw[i] / sum;
      out.push(i === n - 1 ? 1 : acc);
    }
    return out;
  }
  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    const pw = blk.plot[0];
    const ph = blk.plot[1];
    const bw = blk.cols * (pw + blk.gap);
    const bd = blk.rows * (ph + blk.gap);
    const x0 = blk.x;
    const x1 = blk.x + bw;
    const z0 = blk.z - bd;
    const z1 = blk.z;
    const sx0 = proj.px(0, z0);
    const sx1 = proj.px(0, z1);
    const sy0 = proj.py(x1, 0);
    const sy1 = proj.py(x0, 0);
    const amp = 2.6 * u;
    // 田区外沿一圈松土：田埂的颜色，格子之间露出来的就是埂
    tracePoly(organicRect(sx0 - 2.4 * u, sy0 - 2.4 * u, sx1 + 2.4 * u, sy1 + 2.4 * u, amp * 1.2));
    ctx.fillStyle = mixRgba(pal.road, pal.field, 0.42, 0.82);
    ctx.fill();
    tracePoly(organicRect(sx0, sy0, sx1, sy1, amp * 1.5));
    ctx.fillStyle = mixRgba(pal.field, pal.paper, 0.62, 0.5);
    ctx.fill();
    const cols = Math.max(2, blk.cols);
    const rows = Math.max(2, blk.rows);
    const fx = fracs(cols);
    const fy = fracs(rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const qx0 = sx0 + (sx1 - sx0) * fx[c] + 1.5 * u;
        const qx1 = sx0 + (sx1 - sx0) * fx[c + 1] - 1.5 * u;
        const qy0 = sy0 + (sy1 - sy0) * fy[r] + 1.5 * u;
        const qy1 = sy0 + (sy1 - sy0) * fy[r + 1] - 1.5 * u;
        if (qx1 - qx0 < 3 * u || qy1 - qy0 < 2 * u) continue;
        // 偶尔空一块：田不是每格都种满
        if (rand() < 0.08) continue;
        const tone = (r * 3 + c * 5) % 11;
        const wet = tone === 4;
        tracePoly(wobblyRect(qx0, qy0, qx1, qy1, 0.9 * u));
        ctx.fillStyle = wet
          ? mixRgba(pal.road, pal.field, 0.5, 0.62)
          : mixRgba(pal.crop, pal.paper, (r + c) % 2 ? 0.14 : 0.26, 0.9);
        ctx.fill();
        ctx.strokeStyle = mixRgba(pal.road, pal.ink, 0.32, 0.3);
        ctx.lineWidth = 0.7 * u;
        ctx.stroke();
        // 垄：顺着畦的短边犁过去
        const rows2 = Math.max(2, Math.round((qy1 - qy0) / (3.4 * u)));
        for (let t = 0; t < rows2; t++) {
          const ya = qy0 + ((qy1 - qy0) * (t + 0.18)) / rows2;
          ctx.fillStyle = mixRgba(pal.crop, pal.ink, 0.34, 0.12 + (t % 2) * 0.05);
          ctx.fillRect(qx0 + 0.08 * u, ya, qx1 - qx0 - 0.16 * u, Math.max(1, ((qy1 - qy0) / rows2) * 0.32));
        }
        // 苗
        ctx.fillStyle = rgba(pal.ink, 0.15);
        for (let k = 0; k < 4; k++) {
          const mx = qx0 + rand() * (qx1 - qx0);
          const my = qy0 + rand() * (qy1 - qy0);
          ctx.beginPath();
          ctx.arc(mx, my, 0.55 * u, 0, TAU);
          ctx.fill();
        }
        // 灌水口：埂上开个缺口，水从一块流到下一块
        if (rand() < 0.34) {
          const gx = qx0 + (qx1 - qx0) * (0.2 + rand() * 0.6);
          ctx.fillStyle = mixRgba(pal.water, pal.paper, 0.35, 0.55);
          ctx.fillRect(gx - 1.1 * u, qy1 - 0.2 * u, 2.2 * u, 1.5 * u);
          ctx.strokeStyle = rgba(pal.waterEdge, 0.28);
          ctx.lineWidth = 0.4 * u;
          ctx.beginPath();
          ctx.moveTo(gx - 1.1 * u, qy1 + 0.75 * u);
          ctx.lineTo(gx + 1.1 * u, qy1 + 0.75 * u);
          ctx.stroke();
        }
      }
    }
    // 田埂线：断续两笔，不闭合成框
    tracePoly(organicRect(sx0 - 1.6 * u, sy0 - 1.6 * u, sx1 + 1.6 * u, sy1 + 1.6 * u, amp * 1.2));
    ctx.strokeStyle = mixRgba(pal.road, pal.ink, 0.3, 0.28);
    ctx.lineWidth = 0.9 * u;
    ctx.setLineDash([9 * u, 11 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 田头小路：沿着最下一块田的边，微微起伏
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const xx = sx0 + (sx1 - sx0) * t;
      const yy = sy1 - (sy1 - sy0) * 0.03 + Math.sin(t * 5.3 + bi) * 0.9 * u;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.strokeStyle = rgba(pal.road, 0.5);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
  }
}

// ---------- 主路：一条被踩实、压出车辙的土路 ----------
function drawRoad(ctx, proj, cfg, world) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const road = world.village && world.village.road;
  if (!road || !road.points) return;
  const worldPts = smoothWorld(road.points, 8);
  const scr = worldPts.map(function (p) { return [proj.px(p[0], p[1]), proj.py(p[0], p[1])]; });
  const wpx = (road.width || 3.6) * proj.sx;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 路肩
  ctx.strokeStyle = mixRgba(pal.road, pal.paper, 0.34, 0.5);
  ctx.lineWidth = wpx + 4.2 * u;
  strokeLine(ctx, scr);
  // 路面
  ctx.strokeStyle = rgba(pal.road, 0.66);
  ctx.lineWidth = wpx;
  strokeLine(ctx, scr);
  // 两道压边线
  for (let k = -1; k <= 1; k += 2) {
    ctx.strokeStyle = rgba(pal.ink, 0.1);
    ctx.lineWidth = 0.8 * u;
    strokeLine(ctx, offsetScreen(scr, k * wpx * 0.47));
  }
  // 车辙：两道虚线，别画得太规整
  ctx.setLineDash([3.2 * u, 4.4 * u]);
  for (let k = -1; k <= 1; k += 2) {
    ctx.strokeStyle = rgba(pal.ink, 0.09);
    ctx.lineWidth = 1.1 * u;
    strokeLine(ctx, offsetScreen(scr, k * wpx * 0.2));
  }
  ctx.setLineDash([]);
  // 石板：踩碎的石块半埋在路上
  const rand = lcg(6613);
  for (let i = 4; i < scr.length - 4; i += 3) {
    if (rand() < 0.42) continue;
    const p = scr[i];
    const r = (0.5 + rand() * 0.55) * u;
    ctx.beginPath();
    ctx.ellipse(p[0] + (rand() - 0.5) * wpx * 0.5, p[1] + (rand() - 0.5) * wpx * 0.5,
      r * 1.5, r, rand() * 3, 0, TAU);
    ctx.fillStyle = rgba(pal.stone, 0.24);
    ctx.fill();
  }
  // 路边草：贴着路基长出来的几撮
  ctx.strokeStyle = rgba(pal.field, 0.3);
  ctx.lineWidth = 0.7 * u;
  ctx.beginPath();
  for (let i = 3; i < scr.length - 3; i += 2) {
    for (let k = -1; k <= 1; k += 2) {
      const off = k * (wpx * 0.5 + (0.4 + rand() * 0.8) * u);
      const p = offsetScreen(scr.slice(i - 1, i + 2), off)[1];
      const h = (1.8 + rand() * 1.8) * u;
      ctx.moveTo(p[0], p[1] + h * 0.5);
      ctx.lineTo(p[0] + (rand() - 0.5) * 1.8 * u, p[1] - h * 0.6);
    }
  }
  ctx.stroke();
}

function drawVillageGround(ctx, proj, cfg, world, houseInfo, marks) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const road = world.village && world.village.road;
  const rand = lcg(9182);
  // 村里踩实的土：沿路铺一串低透明度的土斑，叠出来是不规则的成片地面
  if (road && road.points) {
    const pts = smoothWorld(road.points, 8);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      const cx = proj.px(p[0], p[1]);
      const cy = proj.py(p[0], p[1]);
      const rx = (11 + rand() * 7) * proj.sx;
      const ry = (8 + rand() * 5) * proj.sy;
      ctx.beginPath();
      ctx.ellipse(cx + (rand() - 0.5) * 6 * proj.sx, cy + (rand() - 0.5) * 6 * proj.sy, rx, ry, rand() * 0.6, 0, TAU);
      ctx.fillStyle = rgba(pal.road, 0.1);
      ctx.fill();
    }
  }
  // 每户门前屋后各一小片，屋子就不像浮在纸上
  if (houseInfo) {
    for (let i = 0; i < houseInfo.length; i++) {
      const h = houseInfo[i];
      const cx = proj.px(h.x, h.z);
      const cy = proj.py(h.x, h.z);
      ctx.beginPath();
      ctx.ellipse(cx, cy, (9 + rand() * 3) * proj.sx, (8 + rand() * 3) * proj.sy, 0, 0, TAU);
      ctx.fillStyle = rgba(pal.road, 0.09);
      ctx.fill();
    }
  }
  // 井台、晒场、柴堆这些常走动的地方，土色更重一点
  const worn = [];
  if (marks) {
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (m.kind === 'well' || m.kind === 'thresh' || m.kind === 'mill' || m.kind === 'vat') worn.push(m);
    }
  }
  for (let i = 0; i < worn.length; i++) {
    const m = worn[i];
    const cx = proj.px(m.x, m.z);
    const cy = proj.py(m.x, m.z);
    const r = (m.kind === 'thresh' ? (m.r || 6) : 4.2) * proj.sx * (1.35 + rand() * 0.3);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, TAU);
    ctx.fillStyle = rgba(pal.road, 0.07);
    ctx.fill();
  }

  // 院墙外散落的碎石与柴屑
  ctx.beginPath();
  if (houseInfo) {
    for (let i = 0; i < houseInfo.length; i++) {
      const h = houseInfo[i];
      for (let k = 0; k < 9; k++) {
        const ang = rand() * TAU;
        const dist = (5.4 + rand() * 5) * proj.sx;
        const px = proj.px(h.x, h.z) + Math.cos(ang) * dist;
        const py = proj.py(h.x, h.z) + Math.sin(ang) * dist * 0.8;
        ctx.moveTo(px + 0.7 * u, py);
        ctx.ellipse(px, py, 0.7 * u, 0.5 * u, rand() * 3, 0, TAU);
      }
    }
  }
  ctx.fillStyle = rgba(pal.stone, 0.16);
  ctx.fill();
}
// ---------- 院落：篱笆围起来的那块夯土地 ----------
function rand01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawYards(ctx, proj, cfg, marks, houseInfo) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const d = cfg.detail || {};
  const a = d.yard === undefined ? 0.16 : d.yard;
  // 每一户门前先垫一层踩实的土场，屋才不是浮在纸上
  if (houseInfo) {
    for (let i = 0; i < houseInfo.length; i++) {
      const h = houseInfo[i];
      const sp = frameOf(proj, h.x, h.z, h.rot);
      polyPath(ctx, rectFrame(sp, -h.w * 0.5 - 1.2, h.h * 0.5 + 3.0, h.w * 0.5 + 1.2, -h.d * 0.5 - 1.6));
      ctx.fillStyle = rgba(pal.yard, a * 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.07);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
      // 场边几笔扫帚痕，土场不是一块色
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const v0 = h.h * 0.5 + 0.6 + rand01(i * 7 + k) * 2.4;
        const pa = sp(-h.w * 0.36, v0);
        const pb = sp(h.w * 0.36, v0 + 0.5);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.strokeStyle = rgba(pal.ink, 0.05);
      ctx.stroke();
    }
  }
  if (!marks) return;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.kind !== 'fence') continue;
    const sp = frameOf(proj, m.x, m.z, m.rot);
    polyPath(ctx, rectFrame(sp, -m.halfW, m.back, m.halfW, m.front));
    ctx.fillStyle = rgba(pal.yard, a * 2.1);
    ctx.fill();
    // 扫帚痕：三五道横向的浅线
    ctx.strokeStyle = rgba(pal.ink, 0.045);
    ctx.lineWidth = 0.7 * u;
    for (let k = 0; k < 5; k++) {
      const v = m.back + (m.front - m.back) * ((k + 0.5) / 5);
      ctx.beginPath();
      const pa = sp(-m.halfW * 0.86, v);
      const pb = sp(m.halfW * 0.86, v);
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
  }
}

// ---------- 阡陌支路：从主路边插到门口 ----------
function drawSpurs(ctx, proj, cfg, houseInfo) {
  if (!houseInfo) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  for (let i = 0; i < houseInfo.length; i++) {
    const h = houseInfo[i];
    const s = h.spur;
    if (!s || !s.pts || s.pts.length < 2) continue;
    const scr = s.pts.map(function (p) { return [proj.px(p[0], p[1]), proj.py(p[0], p[1])]; });
    const half = (s.half || 0.62) * proj.sx * (s.back ? 0.7 : 1.1);
    const band = taperedBand(scr, half, s.taper || 0);
    polyPath(ctx, band);
    ctx.fillStyle = s.back ? mixRgba(pal.road, pal.paper, 0.18, 0.42) : mixRgba(pal.road, pal.paper, 0.06, 0.62);
    ctx.fill();
    if (s.back) {
      // 长巷：两边压深，路面中间略亮
      ctx.strokeStyle = rgba(pal.ink, 0.22);
      ctx.lineWidth = 0.9 * u;
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < band.length / 2; k++) {
        const p = band[k];
        if (k === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = rgba(pal.ink, 0.08);
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
    } else {
      ctx.strokeStyle = rgba(pal.ink, 0.1);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
    }
    // 踏入门口的那几块踏脚石
    if (!s.back) {
      for (let k = 1; k < scr.length - 1; k += 2) {
        const p = scr[k];
        ctx.beginPath();
        ctx.ellipse(p[0], p[1] + 0.4 * u, 1.5 * u, 1.0 * u, 0, 0, TAU);
        ctx.fillStyle = rgba(pal.stone, 0.26);
        ctx.fill();
      }
    }
  }
}

// ---------- 晒谷场：村子中段那块夯土圆场 ----------
function drawThresh(ctx, proj, cfg, marks) {
  if (!marks) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.kind !== 'thresh') continue;
    const cx = proj.px(m.x, m.z);
    const cy = proj.py(m.x, m.z);
    const r = m.r * proj.sx;
    // 场院
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = rgba(pal.yard, 0.62);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.3);
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([3.4 * u, 2.6 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 边上一圈踩实的深色
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, TAU);
    ctx.strokeStyle = rgba(pal.road, 0.34);
    ctx.lineWidth = 2.2 * u;
    ctx.stroke();
    // 摊开的谷子
    for (let k = 0; k < m.grain.length; k++) {
      const g = m.grain[k];
      const gx = proj.px(g[0], g[1]);
      const gy = proj.py(g[0], g[1]);
      const gw = g[2] * proj.sx * 0.5;
      const gd = g[3] * proj.sy * 0.5;
      ctx.beginPath();
      ctx.ellipse(gx, gy, gw, gd, g[4] * TAU, 0, TAU);
      ctx.fillStyle = rgba(pal.hay, 0.42);
      ctx.fill();
    }
    // 草垛：两座，底下压一圈散草
    for (let k = 0; k < m.hay.length; k++) {
      const hx = proj.px(m.hay[k][0], m.hay[k][1]);
      const hy = proj.py(m.hay[k][0], m.hay[k][1]);
      const hr = Math.max(2.4, 1.1 * proj.sx);
      ctx.beginPath();
      ctx.arc(hx + 1.2 * u, hy + 1.4 * u, hr * 1.05, 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, TAU);
      ctx.fillStyle = rgba(pal.hay, 0.82);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.24);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, hr * 0.42, 0, TAU);
      ctx.strokeStyle = rgba(pal.ink, 0.22);
      ctx.stroke();
    }
    // 石碾
    if (m.roller) {
      const rx = proj.px(m.roller[0], m.roller[1]);
      const ry = proj.py(m.roller[0], m.roller[1]);
      ctx.beginPath();
      ctx.arc(rx, ry, 1.9 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.stone, 0.8);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.3);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rx - 2.6 * u, ry);
      ctx.lineTo(rx + 2.6 * u, ry);
      ctx.strokeStyle = rgba(pal.roof, 0.7);
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
    }
  }
}

// ---------- 桑竹：3D 里的竹丛与桑树，按同一份落点画 ----------
function drawBamboo(ctx, proj, cfg, world, src, marks) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const bb = world.village && world.village.bamboo;
  if (!bb) return;
  const areas = bb.areas || (bb.area ? [bb.area] : []);
  const rand = lcg(7713);
  // 林影：两块竹林的位置先铺一层若有若无的绿
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    const cx = proj.px((a[0] + a[2]) * 0.5, (a[1] + a[3]) * 0.5);
    const cy = proj.py((a[0] + a[2]) * 0.5, (a[1] + a[3]) * 0.5);
    const rx = ((a[2] - a[0]) * 0.5) * proj.sx;
    const ry = ((a[3] - a[1]) * 0.5) * proj.sy;
    const g = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, rgba(pal.bamboo, 0.07));
    g.addColorStop(1, rgba(pal.bamboo, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
    // 边缘几笔竹叶，提示这块是竹林不是草地
    ctx.strokeStyle = rgba(pal.bamboo, 0.12);
    ctx.lineWidth = 0.7 * u;
    ctx.beginPath();
    for (let k = 0; k < 80; k++) {
      const t = rand() * TAU;
      const rr = 0.7 + rand() * 0.35;
      const sx = cx + Math.cos(t) * rx * rr;
      const sy = cy + Math.sin(t) * ry * rr;
      const len = (2.2 + rand() * 2.4) * u;
      ctx.moveTo(sx, sy + len * 0.4);
      ctx.lineTo(sx + (rand() - 0.5) * 2 * u, sy - len * 0.6);
    }
    ctx.stroke();
  }

  const spots = (src && src.bamboo) || [];
  if (!spots.length) return;
  // 晒谷场上不长竹：那几丛在图上跳过，免得地面像打了补丁
  const floors = [];
  if (marks) for (let i = 0; i < marks.length; i++) if (marks[i].kind === 'thresh') floors.push(marks[i]);
  const stalks = [];
  const leaves = [];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const x = s[0];
    const z = s[1];
    let onFloor = false;
    for (let k = 0; k < floors.length; k++) {
      if (Math.hypot(x - floors[k].x, z - floors[k].z) < floors[k].r + 0.8) { onFloor = true; break; }
    }
    if (onFloor) continue;
    const cx = proj.px(x, z);
    const cy = proj.py(x, z);
    if (cx < -6 || cy < -6 || cx > proj.w + 6 || cy > proj.h + 6) continue;
    // 竹丛的影
    ctx.beginPath();
    ctx.arc(cx, cy + 1.6 * u, (4.6 + rand() * 2.6) * u, 0, TAU);
    ctx.fillStyle = rgba(pal.bamboo, 0.1);
    ctx.fill();
    // 竿：三根斜上的细笔
    const h = (7.2 + rand() * 4.2) * u * (s[2] || 1);
    const nStalk = 3;
    for (let q = 0; q < nStalk; q++) {
      const lean = (q - 1) * 1.1 * u + (rand() - 0.5) * 0.7 * u;
      stalks.push([cx + (rand() - 0.5) * 1.6 * u, cy + 1.2 * u, cx + lean, cy - h]);
    }
    // 叶：顶端一蓬，五六笔
    const top = cy - h;
    const nLeaf = 9 + Math.floor(rand() * 5);
    for (let q = 0; q < nLeaf; q++) {
      const a = rand() * TAU;
      const len = (1.8 + rand() * 2.2) * u;
      const bx = cx + (rand() - 0.5) * 2.4 * u;
      const by = top + (rand() - 0.3) * 2.0 * u;
      leaves.push([bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len * 0.8]);
    }
  }
  ctx.strokeStyle = rgba(pal.bamboo, 0.6);
  ctx.lineWidth = 0.85 * u;
  ctx.beginPath();
  for (let i = 0; i < stalks.length; i++) {
    const s = stalks[i];
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(s[2], s[3]);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(pal.bamboo, 0.72);
  ctx.lineWidth = 1.0 * u;
  ctx.beginPath();
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    ctx.moveTo(l[0], l[1]);
    ctx.lineTo(l[2], l[3]);
  }
  ctx.stroke();
}

// ---------- 桑林 ----------
function drawMulberry(ctx, proj, cfg, src) {
  const pal = cfg.palette;
  const u = (proj.w / cfg.design) * 1.55;
  const spots = (src && src.mulberry) || [];
  const rand = lcg(4242);
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    // 桑田虽是成行栽的，画到图上也得松一松，不然像一排排纽扣
    const jx = (rand() - 0.5) * 2.8 * u;
    const jy = (rand() - 0.5) * 2.8 * u;
    const cx = proj.px(s[0], s[1]) + jx;
    const cy = proj.py(s[0], s[1]) + jy;
    if (cx < -10 || cy < -10 || cx > proj.w + 10 || cy > proj.h + 10) continue;
    const r = Math.max(1.8, s[2] * proj.sx * (0.66 + rand() * 0.34));
    // 冠影
    ctx.beginPath();
    ctx.ellipse(cx + 1.1 * u, cy + 1.3 * u, r * 0.95, r * 0.7, 0, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.07);
    ctx.fill();
    // 冠：三团错开，边就不是一枚圆
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const ang = 0.7 + k * 2.1;
      const rr = r * (0.62 + (k % 2) * 0.16);
      const qx = cx + Math.cos(ang) * r * 0.34;
      const qy = cy + Math.sin(ang) * r * 0.26;
      ctx.moveTo(qx + rr, qy);
      ctx.arc(qx, qy, rr, 0, TAU);
    }
    ctx.fillStyle = mixRgba(pal.mulberry, pal.ink, 0.16, 0.46);
    ctx.fill();
    // 中间一团深绿，树心才不空
    ctx.beginPath();
    ctx.arc(cx - r * 0.14, cy - r * 0.16, r * 0.5, 0, TAU);
    ctx.fillStyle = mixRgba(pal.mulberry, pal.ink, 0.24, 0.52);
    ctx.fill();
    // 干
    ctx.beginPath();
    ctx.arc(cx, cy, 0.8 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.34);
    ctx.fill();
  }
}

// ---------- 外围经营地：仅使用实景规划通过的坐标，不另撒地图装饰 ----------
export function drawHinterland(ctx, proj, cfg, src) {
  const land = src && src.hinterland;
  if (!land) return;
  const pal = cfg.palette, u = (proj.w / cfg.design) * 1.55;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of land.paths) {
    ctx.beginPath();
    p.points.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](proj.px(x, z), proj.py(x, z)));
    ctx.strokeStyle = rgba(pal.ink, 0.13); ctx.lineWidth = Math.max(0.8 * u, p.width * proj.sx + 0.55 * u); ctx.stroke();
    ctx.strokeStyle = rgba(pal.road || '#CBBE9A', 0.85); ctx.lineWidth = Math.max(0.5 * u, p.width * proj.sx); ctx.stroke();
  }
  for (const t of land.trees) {
    const cx = proj.px(t.x, t.z), cy = proj.py(t.x, t.z), rx = t.radius * proj.sx, ry = t.radius * proj.sy;
    ctx.beginPath(); ctx.ellipse(cx + 0.7 * u, cy + 0.8 * u, rx, ry, 0, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.075); ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = t.rot + k * TAU / 4, x = cx + Math.cos(a) * rx * 0.35, y = cy + Math.sin(a) * ry * 0.35;
      ctx.moveTo(x + rx * 0.64, y); ctx.ellipse(x, y, rx * 0.64, ry * 0.64, 0, 0, TAU);
    }
    const leaf = t.kind === 'mulberry' ? pal.mulberry : pal.bamboo;
    ctx.fillStyle = mixRgba(leaf, pal.ink, 0.12, 0.5); ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.21); ctx.lineWidth = 0.4 * u; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + ry * 0.2); ctx.lineTo(cx, cy - ry * 0.25);
    ctx.lineTo(cx - rx * 0.27, cy - ry * 0.4); ctx.moveTo(cx, cy - ry * 0.15); ctx.lineTo(cx + rx * 0.24, cy - ry * 0.36);
    ctx.strokeStyle = rgba(pal.ink, 0.45); ctx.lineWidth = 0.65 * u; ctx.stroke();
  }
  for (const b of land.bamboo) {
    const x = proj.px(b.x, b.z), y = proj.py(b.x, b.z), r = Math.max(1.0 * u, b.radius * proj.sx);
    ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y - r);
    for (let k = 0; k < 4; k++) {
      const a = b.rot + k * 1.7;
      ctx.moveTo(x, y - r * 0.3); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.strokeStyle = rgba(pal.bamboo, 0.72); ctx.lineWidth = 0.65 * u; ctx.stroke();
  }
  for (const s of land.structures) {
    const frame = frameOf(proj, s.x, s.z, s.rot);
    polyPath(ctx, rectFrame(frame, -s.w / 2, -s.d / 2, s.w / 2, s.d / 2));
    ctx.fillStyle = rgba(s.kind === 'trellis' ? pal.mulberry : '#A9956E', s.kind === 'trellis' ? 0.25 : 0.68); ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.45); ctx.lineWidth = 0.65 * u; ctx.stroke();
    const a = frame(0, -s.d / 2), b = frame(0, s.d / 2);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    if (s.kind !== 'shed') for (let i = 1; i < 5; i++) {
      const z = -s.d / 2 + i * s.d / 5, p = frame(-s.w / 2, z), q = frame(s.w / 2, z);
      ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
    }
  }
  ctx.restore();
}

// 村中生活带：把 3D 布局里真实落地的器物按类型画成俯视小记号，不靠配置猜位置。
function drawVillageLife(ctx, proj, cfg, src) {
  const data = src && src.villageLife;
  if (!data || !data.items) return;
  const pal = cfg.palette, u = (proj.w / cfg.design) * 1.55;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const it of data.items) {
    const sp = frameOf(proj, it.x, it.z, it.rot);
    const r = Math.max(0.55, it.radius || 1) * proj.sx;
    const cx = sp(0, 0);
    ctx.strokeStyle = rgba(pal.ink, 0.5); ctx.lineWidth = 0.5 * u;
    if (it.kind === 'bambooFence') {
      const a = sp(-1.3, 0), b = sp(1.3, 0);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      for (let k = -2; k <= 2; k++) { const p = sp(k * 0.65, 0); ctx.beginPath(); ctx.arc(...p, 0.16 * u, 0, TAU); ctx.fillStyle = rgba(pal.ink, 0.55); ctx.fill(); }
    } else if (it.kind === 'vegetableBed') {
      polyPath(ctx, rectFrame(sp, -1.05, -0.75, 1.05, 0.75));
      ctx.fillStyle = rgba(pal.field || '#7BA05B', 0.42); ctx.fill(); ctx.stroke();
      for (let j = -1; j <= 1; j++) { const a = sp(-0.95, j * 0.45), b = sp(0.95, j * 0.45); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
    } else if (it.kind === 'well' || it.kind === 'stoneMill' || it.kind === 'clayJars') {
      ctx.beginPath(); ctx.ellipse(...cx, r * 0.8, r * 0.8, 0, 0, TAU);
      ctx.fillStyle = rgba(pal.stone || '#A9A294', 0.65); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(...cx, r * 0.42, r * 0.42, 0, 0, TAU); ctx.stroke();
    } else if (it.kind === 'dryingRack' || it.kind === 'gourdTrellis') {
      const a = sp(-1.0, 0), b = sp(1.0, 0);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      for (const s of [-1, 1]) { const p = sp(s, -0.2); ctx.beginPath(); ctx.arc(...p, 0.18 * u, 0, TAU); ctx.fillStyle = rgba(pal.ink, 0.5); ctx.fill(); }
    } else if (it.kind === 'scarecrow') {
      const a = sp(0, 0.5), b = sp(0, -0.9);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      const c = sp(-0.45, 0), d = sp(0.45, 0);
      ctx.beginPath(); ctx.moveTo(...c); ctx.lineTo(...d); ctx.stroke();
      ctx.beginPath(); ctx.arc(...sp(0, -0.55), 0.24 * u, 0, TAU); ctx.fillStyle = rgba(pal.hay || '#D6BC7C', 0.7); ctx.fill();
    } else if (it.kind === 'chickenCoop' || it.kind === 'firewood') {
      polyPath(ctx, rectFrame(sp, -0.6, -0.5, 0.6, 0.5));
      ctx.fillStyle = rgba(pal.roof || '#A68E66', 0.6); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(...cx, r * 0.6, 0, TAU);
      ctx.fillStyle = rgba(pal.stone || '#A9A294', 0.5); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

// Everyday places are drawn from the accepted 3D layout, never from configuration guesses.
export function drawVillageScenes(ctx, proj, cfg, src) {
  const data = src && src.villageScenes;
  if (!data) return;
  const pal=cfg.palette,u=(proj.w/cfg.design)*1.55;
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  for(const path of data.paths || []){
    ctx.beginPath();path.points.forEach(([x,z],i)=>ctx[i?'lineTo':'moveTo'](proj.px(x,z),proj.py(x,z)));
    ctx.strokeStyle=rgba(pal.road || '#CBBE9A',0.78);ctx.lineWidth=Math.max(0.5*u,path.width*proj.sx);ctx.stroke();
  }
  for(const s of data.scenes || []){
    const sp=frameOf(proj,s.x,s.z,s.rot);
    ctx.strokeStyle=rgba(pal.ink,0.46);ctx.lineWidth=0.6*u;
    if(s.kind==='tea'){
      polyPath(ctx,rectFrame(sp,-3.1,-2.32,3.1,2.32));ctx.fillStyle=rgba('#B8AA85',0.65);ctx.fill();ctx.stroke();
      const a=sp(-3.1,0),b=sp(3.1,0);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
      for(const x of [-2.6,2.6])for(const z of [-1.75,1.75]){const p=sp(x,z);ctx.beginPath();ctx.arc(...p,0.5*u,0,TAU);ctx.fillStyle=rgba(pal.ink,0.6);ctx.fill();}
    }else if(s.kind==='laundry'){
      const a=sp(-2.6,-1.5),b=sp(2.6,-1.5);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
      for(let j=0;j<4;j++){polyPath(ctx,rectFrame(sp,-2.36+j*1.22,-1.5,-1.4+j*1.22,-0.55));ctx.fillStyle=rgba(j%2?'#839395':'#C9C3AB',0.85);ctx.fill();ctx.stroke();}
      const p=sp(-2.45,0.2);ctx.beginPath();ctx.ellipse(...p,0.5*proj.sx,0.5*proj.sy,0,0,TAU);ctx.stroke();
      polyPath(ctx,rectFrame(sp,1.65,0.08,2.75,1.32));ctx.fillStyle=rgba('#8F7C5F',0.6);ctx.fill();
    }else if(s.kind==='kiln'){
      const p=sp(-1.35,-1.25);ctx.beginPath();ctx.ellipse(...p,1.13*proj.sx,1.13*proj.sy,0,0,TAU);ctx.fillStyle=rgba('#B18A70',0.8);ctx.fill();ctx.stroke();
      const q=sp(-1.9,-1.65);ctx.beginPath();ctx.arc(...q,0.48*u,0,TAU);ctx.fillStyle=rgba(pal.ink,0.65);ctx.fill();
      polyPath(ctx,rectFrame(sp,0.58,-1.88,2.72,-1.12));ctx.fillStyle=rgba('#AF9A7E',0.72);ctx.fill();ctx.stroke();
      for(let j=0;j<4;j++){const c=sp(0.87+j*0.51,-1.5);ctx.beginPath();ctx.arc(...c,0.34*u,0,TAU);ctx.stroke();}
    }
  }
  for(const p of data.nature || []){
    const sp=frameOf(proj,p.x,p.z,p.rot);ctx.strokeStyle=rgba(pal.bamboo || '#7C9463',0.43);ctx.lineWidth=0.45*u;
    if(p.kind==='fallen-log'){
      const a=sp(0,-1.17),b=sp(0,1.17);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle=rgba('#897C65',0.5);ctx.lineWidth=0.4*proj.sx;ctx.stroke();
    }else{
      const q=sp(0,0);ctx.beginPath();ctx.ellipse(...q,0.6*proj.sx,0.4*proj.sy,0,0,TAU);ctx.fillStyle=rgba(p.kind==='fern-rock'?'#9BA38C':'#B9AC94',0.38);ctx.fill();
    }
    for(let j=0;j<3;j++){const a=sp(-0.5+j*0.4,0.5),b=sp(-0.8+j*0.5,-0.5);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
  }
  ctx.restore();
}

// ---------- 屋舍：俯视一座房，檐、脊、瓦垄、门窗都要有 ----------
function drawHouses(ctx, proj, cfg, houseInfo) {
  if (!houseInfo) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const detail = cfg.detail || {};
  const tileN = detail.tileLines || 4;
  const ov = 0.4;
  // 先落一层影子，全村的影子都朝一个方向，光才是同一个光
  for (let i = 0; i < houseInfo.length; i++) {
    const h = houseInfo[i];
    const sp = frameOf(proj, h.x + 1.9, h.z + 1.5, h.rot || 0);
    polyPath(ctx, rectFrame(sp, -(h.w * 0.5 + ov), -(h.d * 0.5 + ov), h.w * 0.5 + ov, h.d * 0.5 + ov));
    ctx.fillStyle = rgba(pal.ink, 0.09);
    ctx.fill();
  }
  for (let i = 0; i < houseInfo.length; i++) {
    const h = houseInfo[i];
    const W = h.w + ov * 2;
    const D = h.d + ov * 2;
    const sp = frameOf(proj, h.x, h.z, h.rot || 0);
    const hw = W * 0.5;
    const hd = D * 0.5;
    // 屋面：一整片，两坡只差一点深浅，别把房子切成两半
    polyPath(ctx, rectFrame(sp, -hw, -hd, hw, hd));
    ctx.fillStyle = mixRgba(pal.roof, pal.ink, 0.1, 0.95);
    ctx.fill();
    polyPath(ctx, [sp(-hw, 0), sp(hw, 0), sp(hw, hd), sp(-hw, hd)]);
    ctx.fillStyle = mixRgba(pal.roof, pal.paper, 0.26, 0.9);
    ctx.fill();
    // 瓦垄：几道顺着坡走的短线，够看出是瓦顶就行
    ctx.strokeStyle = rgba(pal.ink, 0.14);
    ctx.lineWidth = 0.7 * u;
    ctx.beginPath();
    for (let t = 1; t <= tileN; t++) {
      const uu = -hw + (t / (tileN + 1)) * W;
      const a = sp(uu, 0);
      const b = sp(uu, hd - 0.12);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    // 屋脊：一道重墨压住，房子才立起来
    const r0 = sp(-hw - 0.14, 0);
    const r1 = sp(hw + 0.14, 0);
    ctx.beginPath();
    ctx.moveTo(r0[0], r0[1]);
    ctx.lineTo(r1[0], r1[1]);
    ctx.strokeStyle = rgba(pal.ink, 0.55);
    ctx.lineWidth = 1.5 * u;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 门：朝街的一面留一个小口，这是房子里唯一要读出来的细节
    const doorW = Math.min(1.5, h.w * 0.24);
    const dz0 = hd - 0.28;
    const dz1 = hd + 0.02;
    polyPath(ctx, rectFrame(sp, -doorW * 0.5, dz0, doorW * 0.5, dz1));
    ctx.fillStyle = rgba(pal.ink, 0.5);
    ctx.fill();
    // 檐：四周一圈墨，最外一道最重
    polyPath(ctx, rectFrame(sp, -hw, -hd, hw, hd));
    ctx.strokeStyle = rgba(pal.ink, 0.42);
    ctx.lineWidth = 1.1 * u;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 前檐（朝街的一面）再压一道，屋檐有厚度
    const e0 = sp(-hw, hd);
    const e1 = sp(hw, hd);
    ctx.beginPath();
    ctx.moveTo(e0[0], e0[1]);
    ctx.lineTo(e1[0], e1[1]);
    ctx.strokeStyle = rgba(pal.ink, 0.3);
    ctx.lineWidth = 1.9 * u;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

// ---------- 烟囱：屋脊边上一小方 ----------
function drawChimneys(ctx, proj, cfg, chimneys) {
  if (!chimneys) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  for (let i = 0; i < chimneys.length; i++) {
    const c = chimneys[i];
    const x = proj.px(c.x, c.z);
    const y = proj.py(c.x, c.z);
    ctx.fillStyle = mixRgba(pal.roof, pal.ink, 0.45, 0.92);
    ctx.fillRect(x - 1.5 * u, y - 1.5 * u, 3.0 * u, 3.0 * u);
    ctx.fillStyle = rgba(pal.ink, 0.6);
    ctx.fillRect(x - 0.6 * u, y - 0.6 * u, 1.2 * u, 1.2 * u);
  }
}

// ---------- 家什：井、磨、畦、柴、坛、凳、鸡窝、晾衣 ----------
function drawPropMarks(ctx, proj, cfg, marks) {
  if (!marks) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const wood = mix(pal.roof, pal.ink, 0.2);
  const clay = mix(pal.roof, pal.yard, 0.4);
  const M = proj.sx;
  // 缸、笼、柴堆这些家什按真尺寸只有两三个像素，舆图上得「放大写」
  const big = function (v, min) { return Math.max(v, min * u); };
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const sp = frameOf(proj, m.x, m.z, m.rot);
    if (m.kind === 'tree') {
      const r = Math.max(3.2, m.r * M * 1.05);
      const p = sp(0, 0);
      const base = m.blossom ? pal.peach : pal.bamboo;
      const deep = m.blossom ? pal.peachDeep : pal.mulberry;
      // 冠影：树才不贴在地上
      ctx.beginPath();
      ctx.ellipse(p[0] + 1.7 * u, p[1] + 2.1 * u, r * 0.98, r * 0.66, 0, 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.09);
      ctx.fill();
      // 冠底：整团先压一层，后面三团错开，边就不是一枚圆印章
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, TAU);
      ctx.fillStyle = mixRgba(base, pal.ink, 0.16, 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p[0] - r * 0.2, p[1] - r * 0.24, r * 0.62, 0, TAU);
      ctx.fillStyle = mixRgba(deep, pal.ink, 0.12, 0.58);
      ctx.fill();
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const aa = 0.9 + k * 2.2;
        const rr = r * (0.4 + (k % 2) * 0.1);
        const qx = p[0] + Math.cos(aa) * r * 0.36;
        const qy = p[1] + Math.sin(aa) * r * 0.3;
        ctx.moveTo(qx + rr, qy);
        ctx.arc(qx, qy, rr, 0, TAU);
      }
      ctx.fillStyle = mixRgba(base, pal.ink, 0.06, 0.62);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p[0], p[1], r * 1.02, 0, TAU);
      ctx.strokeStyle = rgba(pal.ink, 0.26);
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(1.0 * u, r * 0.13), 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.3);
      ctx.fill();
      continue;
    }

    if (m.kind === 'fence') {
      // 篱笆：一条木栅带，横竖都得看见，正面留出门口
      const segs = [
        [sp(-m.halfW, m.back), sp(-m.halfW, m.front)],
        [sp(m.halfW, m.back), sp(m.halfW, m.front)],
        [sp(-m.halfW, m.front), sp(-m.gap, m.front)],
        [sp(m.gap, m.front), sp(m.halfW, m.front)],
        [sp(-m.halfW, m.back), sp(m.halfW, m.back)]
      ];
      ctx.lineCap = 'butt';
      for (let q = 0; q < segs.length; q++) {
        ctx.beginPath();
        ctx.moveTo(segs[q][0][0], segs[q][0][1]);
        ctx.lineTo(segs[q][1][0], segs[q][1][1]);
        ctx.strokeStyle = mixRgba(pal.roof, pal.ink, 0.2, 0.55);
        ctx.lineWidth = 2.2 * u;
        ctx.stroke();
        ctx.strokeStyle = rgba(pal.ink, 0.3);
        ctx.lineWidth = 0.6 * u;
        ctx.setLineDash([2.6 * u, 1.5 * u]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 两根门柱
      ctx.fillStyle = mixRgba(pal.roof, pal.ink, 0.2, 0.95);
      for (let k = -1; k <= 1; k += 2) {
        const p = sp(k * m.gap, m.front);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.5 * u, 0, TAU);
        ctx.fill();
      }
      ctx.lineCap = 'round';
    } else if (m.kind === 'garden') {
      const gw = m.w * 0.5;
      const gd = m.d * 0.5;
      polyPath(ctx, rectFrame(sp, -gw, -gd, gw, gd));
      ctx.fillStyle = mixRgba(pal.field, pal.paper, 0.3, 0.5);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.34);
      ctx.lineWidth = 1.0 * u;
      ctx.stroke();
      // 垄与苗：三行，行距拉开，远看是菜畦不是棋盘
      ctx.fillStyle = rgba(pal.crop, 0.9);
      ctx.beginPath();
      for (let r = 0; r < 3; r++) {
        const v = -gd + (r + 0.5) * (m.d / 3);
        const pa = sp(-gw * 0.9, v);
        const pb = sp(gw * 0.9, v);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.strokeStyle = rgba(pal.crop, 0.85);
      ctx.lineWidth = 2.4 * u;
      ctx.stroke();
      ctx.fillStyle = mixRgba(pal.crop, pal.paper, 0.25, 0.95);
      ctx.beginPath();
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const p = sp(-gw + (c + 0.5) * (m.w / 4), -gd + (r + 0.5) * (m.d / 3));
          ctx.moveTo(p[0] + 1.0 * u, p[1]);
          ctx.arc(p[0], p[1], 1.0 * u, 0, TAU);
        }
      }
      ctx.fill();
    } else if (m.kind === 'well') {
      const p = sp(0, 0);
      const r = 6.4 * u;
      // 井台
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, TAU);
      ctx.fillStyle = rgba(pal.stone, 0.95);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.5);
      ctx.lineWidth = 1.0 * u;
      ctx.stroke();
      // 井口
      ctx.beginPath();
      ctx.arc(p[0], p[1], r * 0.48, 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.62);
      ctx.fill();
      // 桔槔：一根横梁挑过来，挂着一只桶
      const A2 = sp(0, -m.r * 2.2);
      const B2 = sp(-m.r * 1.2, m.r * 2.4);
      ctx.beginPath();
      ctx.moveTo(A2[0], A2[1]);
      ctx.lineTo(B2[0], B2[1]);
      ctx.strokeStyle = mixRgba(pal.roof, pal.ink, 0.2, 0.9);
      ctx.lineWidth = 1.1 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(B2[0], B2[1], 1.2 * u, 0, TAU);
      ctx.fillStyle = mixRgba(pal.roof, pal.yard, 0.4, 0.95);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.4);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
    } else if (m.kind === 'mill') {
      const p = sp(0, 0);
      const r = 5.2 * u;
      // 磨盘
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, TAU);
      ctx.fillStyle = rgba(pal.stone, 0.92);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.45);
      ctx.lineWidth = 0.9 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0], p[1], r * 0.62, 0, TAU);
      ctx.strokeStyle = rgba(pal.ink, 0.28);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      // 推磨的木杠
      const b2 = sp(m.r * 3.4, m.r * 1.1);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.strokeStyle = mixRgba(pal.roof, pal.ink, 0.2, 0.85);
      ctx.lineWidth = 1.0 * u;
      ctx.stroke();
    } else if (m.kind === 'vat' || m.kind === 'jars') {
      const list = [];
      if (m.kind === 'jars') {
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * TAU;
          list.push([Math.cos(ang) * m.r * 1.3, Math.sin(ang) * m.r * 1.3]);
        }
      } else {
        list.push([0, 0]);
        list.push([m.r * 1.5, m.r * 0.6]);
      }
      for (let k = 0; k < list.length; k++) {
        const p = sp(list[k][0], list[k][1]);
        const r = m.kind === 'jars' ? 1.6 * u : 2.3 * u;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, TAU);
        ctx.fillStyle = mixRgba(pal.roof, pal.yard, 0.4, 0.9);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.42);
        ctx.lineWidth = 0.6 * u;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p[0] - r * 0.22, p[1] - r * 0.26, r * 0.34, 0, TAU);
        ctx.fillStyle = rgba(pal.paper, 0.55);
        ctx.fill();
      }
    } else if (m.kind === 'woodpile') {
      const ww = 4.6 * u;
      const dd = 3.2 * u;
      polyPath(ctx, rectFrame(sp, -ww, -dd, ww, dd));
      ctx.fillStyle = mixRgba(pal.roof, pal.ink, 0.18, 0.7);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.34);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      // 木头的断面：一排排小圆，才看得出是柴
      ctx.fillStyle = rgba(pal.paper, 0.5);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const p = sp(-ww + (c + 0.5) * (ww * 2 / 3), -dd + (r + 0.5) * (dd * 2 / 2));
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1.0 * u, 0, TAU);
          ctx.fill();
        }
      }
    } else if (m.kind === 'bench') {
      const a2 = sp(-m.len * 0.5, 0);
      const b2 = sp(m.len * 0.5, 0);
      ctx.beginPath();
      ctx.moveTo(a2[0], a2[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.strokeStyle = mixRgba(pal.roof, pal.ink, 0.2, 0.95);
      ctx.lineWidth = 2.2 * u;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.ink, 0.3);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
    } else if (m.kind === 'clothesline') {
      const half = m.len * 0.5;
      const a2 = sp(-half, 0);
      const b2 = sp(half, 0);
      ctx.beginPath();
      ctx.moveTo(a2[0], a2[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.strokeStyle = rgba(pal.ink, 0.4);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      for (let k = -1; k <= 1; k++) {
        const p = sp(k * 0.9 + 0.35, 0.35);
        ctx.beginPath();
        ctx.rect(p[0] - 2.0 * u, p[1], 4.0 * u, 3.0 * u);
        ctx.fillStyle = rgba(pal.cloth, 0.92);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.24);
        ctx.lineWidth = 0.5 * u;
        ctx.stroke();
      }
    } else if (m.kind === 'coop') {
      const ww = 3.2 * u;
      const dd = 2.6 * u;
      polyPath(ctx, rectFrame(sp, -ww, -dd, ww, dd));
      ctx.fillStyle = rgba(pal.hay, 0.8);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.34);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      // 草棚的纹路
      ctx.beginPath();
      for (let k = 1; k <= 3; k++) {
        const v = -dd + (k / 4) * dd * 2;
        const pa = sp(-ww * 0.9, v);
        const pb = sp(ww * 0.9, v);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.strokeStyle = rgba(pal.ink, 0.14);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
      // 两只鸡在门口
      ctx.fillStyle = rgba(pal.paper, 0.9);
      for (let k = 0; k < 2; k++) {
        const p = sp(ww + 1.2 + k * 1.4, dd * (k ? 0.5 : -0.4));
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], 1.1 * u, 0.8 * u, 0, 0, TAU);
        ctx.fill();
      }
    }
  }
}

// ---------- 鸡与狗：村里得有活物 ----------
function drawFauna(ctx, proj, cfg, world, rand) {
  const pal = cfg.palette;
  const u = (proj.w / cfg.design) * 1.55;
  const fa = world.fauna;
  if (!fa) return;
  const chick = fa.chickens && fa.chickens.homes ? fa.chickens.homes : [];
  for (let i = 0; i < chick.length; i++) {
    for (let k = 0; k < 3; k++) {
      const x = chick[i][0] + (rand() - 0.5) * 3.4;
      const z = chick[i][1] + (rand() - 0.5) * 3.4;
      const sx = proj.px(x, z);
      const sy = proj.py(x, z);
      ctx.beginPath();
      ctx.arc(sx, sy, 1.0 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.paper, 0.9);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.4);
      ctx.lineWidth = 0.5 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 0.3 * u, sy - 1.4 * u);
      ctx.lineTo(sx + 0.1 * u, sy - 2.1 * u);
      ctx.strokeStyle = rgba(pal.ink, 0.35);
      ctx.stroke();
    }
  }
  const dogs = fa.dogs && fa.dogs.homes ? fa.dogs.homes : [];
  for (let i = 0; i < dogs.length; i++) {
    const x = dogs[i][0] + (rand() - 0.5) * 4;
    const z = dogs[i][1] + (rand() - 0.5) * 4;
    const sx = proj.px(x, z);
    const sy = proj.py(x, z);
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.0 * u, 1.2 * u, rand() * 3, 0, TAU);
    ctx.fillStyle = rgba(pal.roof, 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + 1.6 * u, sy - 0.3 * u, 0.9 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.45);
    ctx.fill();
  }
  // 雀：桃枝田埂间起落，两笔短线作展翅
  const birds = fa.birds && fa.birds.homes ? fa.birds.homes : [];
  for (let i = 0; i < birds.length; i++) {
    for (let k = 0; k < 2; k++) {
      const x = birds[i][0] + (rand() - 0.5) * 3;
      const z = birds[i][1] + (rand() - 0.5) * 3;
      const sx = proj.px(x, z);
      const sy = proj.py(x, z);
      ctx.beginPath();
      ctx.moveTo(sx - 1.1 * u, sy - 0.6 * u);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + 1.1 * u, sy - 0.6 * u);
      ctx.strokeStyle = rgba(pal.field, 0.6);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
    }
  }
  // 牛：田畔缓行，椭圆身 + 双角
  const oxen = fa.oxen && fa.oxen.homes ? fa.oxen.homes : [];
  for (let i = 0; i < oxen.length; i++) {
    const x = oxen[i][0] + (rand() - 0.5) * 2.6;
    const z = oxen[i][1] + (rand() - 0.5) * 2.6;
    const sx = proj.px(x, z);
    const sy = proj.py(x, z);
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.6 * u, 1.7 * u, rand() * 3, 0, TAU);
    ctx.fillStyle = rgba(pal.mountainDeep, 0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + 2.2 * u, sy - 0.4 * u, 1.0 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.mountainDeep, 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + 2.4 * u, sy - 1.3 * u);
    ctx.lineTo(sx + 3.0 * u, sy - 2.0 * u);
    ctx.moveTo(sx + 2.0 * u, sy - 1.3 * u);
    ctx.lineTo(sx + 1.4 * u, sy - 2.0 * u);
    ctx.strokeStyle = rgba(pal.ink, 0.4);
    ctx.lineWidth = 0.5 * u;
    ctx.stroke();
  }
  // 鸭：美池之畔，小椭圆 + 涟漪一笔
  const ducks = fa.ducks && fa.ducks.homes ? fa.ducks.homes : [];
  for (let i = 0; i < ducks.length; i++) {
    for (let k = 0; k < 2; k++) {
      const x = ducks[i][0] + (rand() - 0.5) * 3.2;
      const z = ducks[i][1] + (rand() - 0.5) * 3.2;
      const sx = proj.px(x, z);
      const sy = proj.py(x, z);
      ctx.beginPath();
      ctx.ellipse(sx, sy, 1.5 * u, 0.9 * u, rand() * 3, 0, TAU);
      ctx.fillStyle = rgba(pal.paper, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.35);
      ctx.lineWidth = 0.5 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx + 1.1 * u, sy - 0.5 * u, 0.6 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.45);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, 2.3 * u, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = rgba(pal.waterEdge, 0.3);
      ctx.stroke();
    }
  }
}

// ---------- 人：路上走的、门口说话的 ----------
function drawFigures(ctx, proj, cfg, world) {
  const d = cfg.detail || {};
  const list = d.figures || [];
  const road = world.village && world.village.road;
  if (!list.length || !road || !road.points) return;
  const pal = cfg.palette;
  const u = (proj.w / cfg.design) * 1.55;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const q = pointAlong(road.points, f[0], proj);
    const side = f[1] || 1;
    const off = f[2] || 1.2;
    const sx = proj.px(q.x + q.nx * side * off, q.z + q.nz * side * off);
    const sy = proj.py(q.x + q.nx * side * off, q.z + q.nz * side * off);
    // 影
    ctx.beginPath();
    ctx.ellipse(sx + 1.0 * u, sy + 2.2 * u, 2.0 * u, 1.1 * u, 0, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.1);
    ctx.fill();
    // 身
    ctx.beginPath();
    ctx.moveTo(sx, sy + 2.2 * u);
    ctx.lineTo(sx, sy - 1.6 * u);
    ctx.strokeStyle = rgba(pal.ink, 0.5);
    ctx.lineWidth = 1.7 * u;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 头
    ctx.beginPath();
    ctx.arc(sx, sy - 2.4 * u, 1.35 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.ink, 0.55);
    ctx.fill();
    // 草帽
    ctx.beginPath();
    ctx.moveTo(sx - 2.1 * u, sy - 3.0 * u);
    ctx.lineTo(sx + 2.1 * u, sy - 3.0 * u);
    ctx.strokeStyle = rgba(pal.hay, 0.9);
    ctx.lineWidth = 0.8 * u;
    ctx.stroke();
  }
}

function drawExterior(ctx, proj, cfg, src) {
  const ext = src && src.exterior;
  if (!ext) return;
  const pal = cfg.palette;
  const u = proj.w / cfg.design;
  const paths = ext.paths || [];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(pal.ink, 0.25);
  ctx.lineWidth = 0.85 * u;
  ctx.setLineDash([2.1 * u, 2.2 * u]);
  for (let i = 0; i < paths.length; i++) {
    const pts = paths[i];
    if (!pts || pts.length < 2) continue;
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const pt = pts[k];
      const wx = Array.isArray(pt) ? pt[0] : pt.x;
      const wz = Array.isArray(pt) ? pt[pt.length - 1] : pt.z;
      const sx = proj.px(wx, wz);
      const sy = proj.py(wx, wz);
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const stops = ext.stops || [];
  for (let i = 0; i < stops.length; i++) {
    const st = stops[i];
    const sx = proj.px(st.x, st.z);
    const sy = proj.py(st.x, st.z);
    ctx.beginPath();
    ctx.arc(sx, sy, 1.45 * u, 0, TAU);
    ctx.fillStyle = rgba(pal.paper, 0.85);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.42);
    ctx.lineWidth = 0.65 * u;
    ctx.stroke();
  }
  ctx.restore();
}

function paintHillPine(ctx, px, py, r, pal, rand, phenologyId = 'spring', tint = null) {
  ctx.beginPath();
  ctx.ellipse(px + 0.7 * r, py + 0.7 * r, r * 0.95, r * 0.72, 0, 0, TAU);
  ctx.fillStyle = rgba(pal.ink, 0.08);
  ctx.fill();
  const c0 = tint ? tint[0] : mixRgba(pal.bamboo, pal.ink, 0.34, 0.44);
  const c1 = tint ? tint[1] : mixRgba(pal.bamboo, pal.field, 0.28, 0.40);
  const cMid = tint ? tint[2] : mixRgba(pal.bamboo, pal.ink, 0.46, 0.46);
  for (let k = 0; k < 3; k++) {
    const a = 0.5 + k * 2.09 + (rand() - 0.5) * 0.35;
    const ox = Math.cos(a) * r * 0.36;
    const oy = Math.sin(a) * r * 0.28;
    ctx.beginPath();
    ctx.arc(px + ox, py + oy, r * (0.62 + (k % 2) * 0.14), 0, TAU);
    ctx.fillStyle = k === 0 ? c0 : c1;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(px - r * 0.12, py - r * 0.10, r * 0.42, 0, TAU);
  ctx.fillStyle = cMid;
  ctx.fill();
  if (phenologyId === 'winter') {
    ctx.fillStyle = rgba(pal.paper, 0.80);
    ctx.beginPath();
    ctx.arc(px - r * 0.24, py - r * 0.24, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + r * 0.20, py - r * 0.18, r * 0.24, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(px, py, Math.max(0.55, r * 0.18), 0, TAU);
  ctx.fillStyle = rgba(pal.ink, 0.36);
  ctx.fill();
}

function paintFacetCrag(ctx, px, py, r, rot, pal, u, phenologyId = 'spring') {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const pt = (lx, ly) => [px + (lx * ca - ly * sa) * r, py + (lx * sa + ly * ca) * r * 0.76];
  const p0 = pt(-1.0, -0.35);
  const p1 = pt(-0.25, -1.0);
  const p2 = pt(0.95, -0.45);
  const p3 = pt(1.05, 0.55);
  const p4 = pt(-0.35, 0.95);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.lineTo(p4[0], p4[1]);
  ctx.closePath();
  ctx.fillStyle = mixRgba(pal.stone, pal.mountainDeep, 0.48, 0.58);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.lineTo(p4[0], p4[1]);
  ctx.lineTo(p0[0], p0[1]);
  ctx.strokeStyle = rgba(pal.ink, 0.28);
  ctx.lineWidth = 0.55 * u;
  ctx.stroke();
  if (phenologyId === 'winter') {
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.strokeStyle = rgba(pal.paper, 0.76);
    ctx.lineWidth = 1.05 * u;
    ctx.stroke();
  }
}

function drawRound6Landmarks(ctx, proj, cfg, src, world) {
  if (!src || (!src.waterworks && !src.leisureGrove && !src.oxPlowing && !src.qinHanCompletion)) return;
  const pal = cfg.palette;
  const phenologyId = cfg.phenologyId || 'spring';
  const u = proj.w / cfg.design;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const ww = src.waterworks;
  if (ww) {
    const springRaces = ww.springRaces || [];
    for (let i = 0; i < springRaces.length; i++) {
      const pts = springRaces[i].points || [];
      if (pts.length < 2) continue;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const sx = proj.px(pts[k].x, pts[k].z);
        const sy = proj.py(pts[k].x, pts[k].z);
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = rgba(pal.waterEdge, 0.7);
      ctx.lineWidth = 1.45 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.water, 0.85);
      ctx.lineWidth = 0.85 * u;
      ctx.stroke();
    }
    const springs = ww.springs || [];
    for (let i = 0; i < springs.length; i++) {
      const sp = springs[i];
      const sx = proj.px(sp.x, sp.z);
      const sy = proj.py(sp.x, sp.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 0.95 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.water, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.72);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
    }
    const conduits = ww.conduits || [];
    for (let i = 0; i < conduits.length; i++) {
      const c = conduits[i];
      const pts = c.points || [];
      if (pts.length < 2) continue;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const sx = proj.px(pts[k].x, pts[k].z);
        const sy = proj.py(pts[k].x, pts[k].z);
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      const isSurfaceChannel = c.kind === 'canal' || c.kind === 'rill';
      ctx.strokeStyle = rgba(pal.waterEdge, isSurfaceChannel ? 0.65 : 0.55);
      ctx.lineWidth = (isSurfaceChannel ? 1.3 : 1.05) * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.water, isSurfaceChannel ? 0.85 : 0.72);
      ctx.lineWidth = (isSurfaceChannel ? 0.72 : 0.55) * u;
      ctx.stroke();
    }
    const beds = ww.beds || [];
    for (let i = 0; i < beds.length; i++) {
      const b = beds[i];
      const bx = proj.px(b.x, b.z);
      const by = proj.py(b.x, b.z);
      ctx.fillStyle = rgba(pal.field, 0.65);
      ctx.fillRect(bx - 1.4 * u, by - 1.4 * u, 2.8 * u, 2.8 * u);
      ctx.strokeStyle = rgba(pal.ink, 0.35);
      ctx.lineWidth = 0.55 * u;
      ctx.strokeRect(bx - 1.4 * u, by - 1.4 * u, 2.8 * u, 2.8 * u);
    }
    const wheels = ww.wheels || [];
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const wx = proj.px(w.x, w.z);
      const wy = proj.py(w.x, w.z);
      const r = 1.9 * u;
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, TAU);
      ctx.fillStyle = rgba(pal.paper, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.62);
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(wx - Math.cos(a) * r, wy - Math.sin(a) * r);
        ctx.lineTo(wx + Math.cos(a) * r, wy + Math.sin(a) * r);
        ctx.stroke();
      }
    }
    const traps = ww.traps || [];
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i];
      const tx = proj.px(t.x, t.z);
      const ty = proj.py(t.x, t.z);
      ctx.beginPath();
      ctx.arc(tx, ty, 1.15 * u, 0, TAU);
      ctx.strokeStyle = rgba(pal.ink, 0.5);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
    }
  }

  const lg = src.leisureGrove;
  if (lg) {
    if (lg.conduit && lg.conduit.points && lg.conduit.points.length >= 2) {
      const pts = lg.conduit.points;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const sx = proj.px(pts[k].x, pts[k].z);
        const sy = proj.py(pts[k].x, pts[k].z);
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = rgba(pal.bamboo, 0.55);
      ctx.lineWidth = 0.85 * u;
      ctx.stroke();
    }
    if (lg.brook && lg.brook.points && lg.brook.points.length >= 2) {
      const pts = lg.brook.points;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const sx = proj.px(pts[k].x, pts[k].z);
        const sy = proj.py(pts[k].x, pts[k].z);
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = rgba(pal.waterEdge, 0.7);
      ctx.lineWidth = 1.75 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.water, 0.86);
      ctx.lineWidth = 1.05 * u;
      ctx.stroke();
      if (lg.brook.spring) {
        const bsx = proj.px(lg.brook.spring.x, lg.brook.spring.z);
        const bsy = proj.py(lg.brook.spring.x, lg.brook.spring.z);
        ctx.beginPath();
        ctx.arc(bsx, bsy, 0.75 * u, 0, TAU);
        ctx.fillStyle = rgba(pal.water, 0.85);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.waterEdge, 0.65);
        ctx.lineWidth = 0.55 * u;
        ctx.stroke();
      }
    }
    if (lg.bridge) {
      const br = lg.bridge;
      const e0 = br.ends?.[0] || { x: br.x, z: br.z - (br.length || 3.6) * 0.5 };
      const e1 = br.ends?.[1] || { x: br.x, z: br.z + (br.length || 3.6) * 0.5 };
      const dx = e1.x - e0.x;
      const dz = e1.z - e0.z;
      const dlen = Math.hypot(dx, dz) || 1;
      const nx = -dz / dlen;
      const nz = dx / dlen;
      const hw = (br.width || 1.14) * 0.5;
      const corners = [
        [e0.x - nx * hw, e0.z - nz * hw],
        [e0.x + nx * hw, e0.z + nz * hw],
        [e1.x + nx * hw, e1.z + nz * hw],
        [e1.x - nx * hw, e1.z - nz * hw]
      ];
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const px = proj.px(corners[k][0], corners[k][1]);
        const py = proj.py(corners[k][0], corners[k][1]);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(pal.hay, 0.86);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.64);
      ctx.lineWidth = 0.68 * u;
      ctx.stroke();
    }
    if (lg.feast) {
      const fx = proj.px(lg.feast.x, lg.feast.z);
      const fy = proj.py(lg.feast.x, lg.feast.z);
      ctx.fillStyle = rgba(pal.hay, 0.82);
      ctx.fillRect(fx - 1.45 * u, fy - 1.15 * u, 2.9 * u, 2.3 * u);
      ctx.strokeStyle = rgba(pal.ink, 0.52);
      ctx.lineWidth = 0.55 * u;
      ctx.strokeRect(fx - 1.45 * u, fy - 1.15 * u, 2.9 * u, 2.3 * u);
      ctx.fillStyle = rgba(pal.peach, 0.72);
      ctx.fillRect(fx - 0.55 * u, fy - 0.35 * u, 1.1 * u, 0.7 * u);
    }
    const regions = lg.regions || [];
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const rx = proj.px(r.x, r.z);
      const ry = proj.py(r.x, r.z);
      if (r.kind === 'pavilion') {
        const s = 2.4 * u;
        ctx.fillStyle = rgba(pal.hay, 0.85);
        ctx.fillRect(rx - s, ry - s, s * 2, s * 2);
        ctx.strokeStyle = rgba(pal.ink, 0.68);
        ctx.lineWidth = 0.85 * u;
        ctx.strokeRect(rx - s, ry - s, s * 2, s * 2);
      } else if (r.kind === 'social-tree') {
        ctx.beginPath();
        ctx.arc(rx, ry, 2.7 * u, 0, TAU);
        ctx.fillStyle = rgba(pal.bamboo, 0.28);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.36);
        ctx.lineWidth = 0.65 * u;
        ctx.stroke();
      } else if (r.kind === 'orchard') {
        ctx.beginPath();
        ctx.arc(rx, ry, 2.2 * u, 0, TAU);
        ctx.fillStyle = rgba(pal.peach, 0.25);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.28);
        ctx.lineWidth = 0.55 * u;
        ctx.stroke();
      } else if (r.kind === 'apiary') {
        for (const dx of [-0.9 * u, 0.9 * u]) {
          ctx.beginPath();
          ctx.arc(rx + dx, ry, 0.75 * u, 0, TAU);
          ctx.fillStyle = rgba(pal.hay, 0.78);
          ctx.fill();
          ctx.strokeStyle = rgba(pal.ink, 0.45);
          ctx.lineWidth = 0.5 * u;
          ctx.stroke();
        }
      }
    }
  }
  const qh = (src.leisureGrove && src.leisureGrove.qinHan) || src.qinHan;
  if (qh) {
    for (const [site, col] of [[qh.weaving, pal.waterEdge || pal.ink], [qh.carpentry, pal.timber || pal.ink], [qh.pottery, pal.roof || pal.ink], [qh.fieldHut, pal.hay]]) {
      if (!site || !Number.isFinite(site.x) || !Number.isFinite(site.z)) continue;
      const sx = proj.px(site.x, site.z);
      const sy = proj.py(site.x, site.z);
      ctx.beginPath();
      ctx.rect(sx - 1.2 * u, sy - 0.9 * u, 2.4 * u, 1.8 * u);
      ctx.fillStyle = rgba(col, 0.72);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.52);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
  }
  const vb = src.leisureGrove && src.leisureGrove.borderlands;
  if (vb) {
    // 1) 山野石径与北麓平畴土路
    for (const p of vb.paths || []) {
      const pts = p.points;
      if (!pts || pts.length < 2) continue;
      const scr = pts.map(q => [proj.px(q[0], q[1]), proj.py(q[0], q[1])]);
      ctx.beginPath();
      ctx.moveTo(scr[0][0], scr[0][1]);
      for (let i = 1; i < scr.length; i++) ctx.lineTo(scr[i][0], scr[i][1]);
      ctx.strokeStyle = rgba(p.kind === 'flagstone' ? pal.stone : pal.road, 0.72);
      ctx.lineWidth = (p.width || 1.35) * proj.sx * 0.72;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.ink, 0.22);
      ctx.lineWidth = 0.45 * u;
      ctx.stroke();
    }
    // 2) 北麓叠翠曲水梯田
    for (const tier of vb.terraces || []) {
      const inn = tier.inner || [];
      const out = tier.outer || [];
      if (inn.length < 2 || out.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(proj.px(inn[0][0], inn[0][1]), proj.py(inn[0][0], inn[0][1]));
      for (let i = 1; i < inn.length; i++) ctx.lineTo(proj.px(inn[i][0], inn[i][1]), proj.py(inn[i][0], inn[i][1]));
      for (let i = out.length - 1; i >= 0; i--) ctx.lineTo(proj.px(out[i][0], out[i][1]), proj.py(out[i][0], out[i][1]));
      ctx.closePath();
      ctx.fillStyle = mixRgba(pal.water, pal.crop, 0.28, 0.62);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.waterEdge || pal.ink, 0.48);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
    }
    // 3) 北涧三叠飞泉、碧玉潭、清渠与青石桥
    if (vb.brook && vb.brook.points && vb.brook.points.length > 1) {
      const bpts = vb.brook.points;
      ctx.beginPath();
      ctx.moveTo(proj.px(bpts[0][0], bpts[0][1]), proj.py(bpts[0][0], bpts[0][1]));
      for (let i = 1; i < bpts.length; i++) ctx.lineTo(proj.px(bpts[i][0], bpts[i][1]), proj.py(bpts[i][0], bpts[i][1]));
      ctx.strokeStyle = rgba(pal.water, 0.85);
      ctx.lineWidth = (vb.brook.width || 1.8) * proj.sx * 0.85;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.45);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    if (vb.waterfall) {
      const wx = proj.px(vb.waterfall.poolX, vb.waterfall.poolZ);
      const wy = proj.py(vb.waterfall.poolX, vb.waterfall.poolZ);
      const wr = (vb.waterfall.poolRadius || 5.2) * proj.sx * 0.85;
      ctx.beginPath();
      ctx.arc(wx, wy, wr, 0, TAU);
      ctx.fillStyle = rgba(pal.water, 0.82);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.58);
      ctx.lineWidth = 0.7 * u;
      ctx.stroke();
      // Cascade white-water strokes from topX/topZ into pool
      const tx = proj.px(vb.waterfall.topX, vb.waterfall.topZ);
      const ty = proj.py(vb.waterfall.topX, vb.waterfall.topZ);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(wx, wy);
      ctx.strokeStyle = rgba(pal.waterEdge, 0.65);
      ctx.lineWidth = 2.2 * u;
      ctx.stroke();
    }
    if (vb.stoneBridge) {
      const bx = proj.px(vb.stoneBridge.x, vb.stoneBridge.z);
      const by = proj.py(vb.stoneBridge.x, vb.stoneBridge.z);
      ctx.beginPath();
      ctx.rect(bx - 1.1 * u, by - 1.8 * u, 2.2 * u, 3.6 * u);
      ctx.fillStyle = rgba(pal.stone, 0.92);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.58);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    // 4) 西坞云雾茶垄与药畦
    for (const row of vb.teaRows || []) {
      if (row.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(proj.px(row[0][0], row[0][1]), proj.py(row[0][0], row[0][1]));
      for (let i = 1; i < row.length; i++) ctx.lineTo(proj.px(row[i][0], row[i][1]), proj.py(row[i][0], row[i][1]));
      ctx.strokeStyle = rgba(pal.bamboo, 0.52);
      ctx.lineWidth = 1.25 * u;
      ctx.stroke();
    }
    // 5) 苍松、山杏野梅、修竹与山石点染
    for (const cr of vb.crags || []) {
      ctx.beginPath();
      ctx.arc(proj.px(cr[0], cr[1]), proj.py(cr[0], cr[1]), Math.max(0.8, cr[2] * 0.75) * u, 0, TAU);
      ctx.fillStyle = rgba(pal.mountainDeep, 0.28);
      ctx.fill();
    }
    for (const bm of vb.bamboo || []) {
      ctx.beginPath();
      ctx.arc(proj.px(bm[0], bm[1]), proj.py(bm[0], bm[1]), 1.35 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.bamboo, 0.34);
      ctx.fill();
    }
    for (const bl of vb.blossoms || []) {
      ctx.beginPath();
      ctx.arc(proj.px(bl[0], bl[1]), proj.py(bl[0], bl[1]), 1.65 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.peach, 0.34);
      ctx.fill();
    }
    for (const pn of vb.pines || []) {
      ctx.beginPath();
      ctx.arc(proj.px(pn[0], pn[1]), proj.py(pn[0], pn[1]), 1.75 * u, 0, TAU);
      ctx.fillStyle = mixRgba(pal.bamboo, pal.ink, 0.35, 0.38);
      ctx.fill();
    }
    // 6) 东皋观云亭、晒秋坪、望稼草楼与山阴药庐建筑图标
    if (vb.sunningTerrace) {
      const sx = proj.px(vb.sunningTerrace.x, vb.sunningTerrace.z);
      const sy = proj.py(vb.sunningTerrace.x, vb.sunningTerrace.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.8 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.yard, 0.72);
      ctx.fill();
      for (const [ox, oy, col] of [[-1, -0.7, pal.seal], [0.9, -0.6, pal.hay], [-0.4, 0.9, pal.crop], [1.0, 0.8, pal.hay]]) {
        ctx.beginPath();
        ctx.arc(sx + ox * u, sy + oy * u, 0.62 * u, 0, TAU);
        ctx.fillStyle = rgba(col, 0.82);
        ctx.fill();
      }
    }
    if (vb.cloudPavilion) {
      const px = proj.px(vb.cloudPavilion.x, vb.cloudPavilion.z);
      const py = proj.py(vb.cloudPavilion.x, vb.cloudPavilion.z);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = px + Math.cos(a) * 2.5 * u;
        const y = py + Math.sin(a) * 2.5 * u;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(pal.roof, 0.88);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.65);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
    }
    for (const bld of [vb.watchtower, vb.herbCottage]) {
      if (!bld) continue;
      const bx = proj.px(bld.x, bld.z);
      const by = proj.py(bld.x, bld.z);
      ctx.beginPath();
      ctx.rect(bx - 1.8 * u, by - 1.5 * u, 3.6 * u, 3.0 * u);
      ctx.fillStyle = rgba(pal.roof, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.62);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
    }
  }

  // 外山幽境（东涧清溪、九条山径、六处秘境建筑与山野林石点染）
  const r6Rand = lcg(60621);
  const ow = (src.leisureGrove && src.leisureGrove.outerWilds) || src.outerWilds;
  if (ow) {
    for (const tr of ow.trails || []) {
      const pts = tr.points;
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(proj.px(pts[0][0], pts[0][1]), proj.py(pts[0][0], pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(proj.px(pts[i][0], pts[i][1]), proj.py(pts[i][0], pts[i][1]));
      const tw = (tr.width || 1.3) * proj.sx * 0.78;
      ctx.strokeStyle = rgba(pal.ink, 0.16);
      ctx.lineWidth = tw + 0.7 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(tr.kind === 'flagstone' ? pal.stone : pal.road, 0.84);
      ctx.lineWidth = tw;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.ink, 0.22);
      ctx.lineWidth = 0.45 * u;
      ctx.stroke();
    }
    if (ow.rill && ow.rill.points && ow.rill.points.length > 1) {
      const rpts = ow.rill.points;
      ctx.beginPath();
      ctx.moveTo(proj.px(rpts[0][0], rpts[0][1]), proj.py(rpts[0][0], rpts[0][1]));
      for (let i = 1; i < rpts.length; i++) ctx.lineTo(proj.px(rpts[i][0], rpts[i][1]), proj.py(rpts[i][0], rpts[i][1]));
      ctx.strokeStyle = rgba(pal.water, 0.88);
      ctx.lineWidth = (ow.rill.width || 1.38) * proj.sx * 0.90;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.48);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    for (const cr of ow.cragSpots || []) {
      paintFacetCrag(ctx, proj.px(cr[0], cr[1]), proj.py(cr[0], cr[1]), (2.0 + r6Rand() * 1.1) * u, r6Rand() * TAU, pal, u, phenologyId);
    }
    for (const bm of ow.bambooSpots || []) {
      const bx = proj.px(bm[0], bm[1]);
      const by = proj.py(bm[0], bm[1]);
      const br = (2.1 + r6Rand() * 1.1) * u;
      ctx.beginPath();
      ctx.arc(bx, by + 0.6 * u, br * 1.05, 0, TAU);
      ctx.fillStyle = rgba(pal.bamboo, 0.14);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 0.8 * u, by + br);
      ctx.lineTo(bx - 0.3 * u, by - br);
      ctx.moveTo(bx + 0.7 * u, by + br * 0.9);
      ctx.lineTo(bx + 1.1 * u, by - br * 0.85);
      for (let k = 0; k < 4; k++) {
        const a = r6Rand() * TAU;
        ctx.moveTo(bx, by - br * 0.5);
        ctx.lineTo(bx + Math.cos(a) * br * 0.95, by - br * 0.5 + Math.sin(a) * br * 0.75);
      }
      ctx.strokeStyle = rgba(pal.bamboo, 0.64);
      ctx.lineWidth = 0.78 * u;
      ctx.stroke();
    }
    for (const mp of ow.mapleSpots || []) {
      const mx = proj.px(mp[0], mp[1]);
      const my = proj.py(mp[0], mp[1]);
      const mr = (2.1 + r6Rand() * 0.9) * u * (phenologyId === 'autumn' ? 1.18 : 1);
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + r6Rand() * 0.4;
        ctx.beginPath();
        ctx.arc(mx + Math.cos(a) * mr * 0.32, my + Math.sin(a) * mr * 0.28, mr * 0.65, 0, TAU);
        if (phenologyId === 'autumn') {
          ctx.fillStyle = k === 0
            ? mixRgba(pal.seal, pal.hay, 0.30, 0.64)
            : mixRgba(pal.seal, pal.paper, 0.14, 0.56);
        } else if (phenologyId === 'winter') {
          ctx.fillStyle = mixRgba(pal.stone, pal.paper, 0.42, 0.44);
        } else {
          ctx.fillStyle = k === 0
            ? mixRgba(pal.field, pal.seal, 0.52, 0.46)
            : mixRgba(pal.hay, pal.seal, 0.38, 0.44);
        }
        ctx.fill();
      }
      if (phenologyId === 'winter') {
        ctx.beginPath();
        ctx.arc(mx - mr * 0.18, my - mr * 0.20, mr * 0.28, 0, TAU);
        ctx.fillStyle = rgba(pal.paper, 0.72);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(mx, my, 0.55 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.ink, 0.32);
      ctx.fill();
    }
    for (const pn of ow.pineSpots || []) {
      paintHillPine(ctx, proj.px(pn[0], pn[1]), proj.py(pn[0], pn[1]), (2.3 + r6Rand() * 1.1) * u, pal, r6Rand, phenologyId);
    }
    const owSanct = ow.sanctuaries || {};
    if (owSanct.logBridge) {
      const lb = owSanct.logBridge;
      const bx = proj.px(lb.x, lb.z);
      const by = proj.py(lb.x, lb.z);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(-(lb.yaw || 0));
      ctx.beginPath();
      ctx.rect(-2.4 * u, -0.75 * u, 4.8 * u, 1.5 * u);
      ctx.fillStyle = rgba(pal.timber || pal.roof, 0.90);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.62);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
      ctx.restore();
    }
    if (owSanct.lankeCrag) {
      const lk = owSanct.lankeCrag;
      const lx = proj.px(lk.x, lk.z);
      const ly = proj.py(lk.x, lk.z);
      ctx.beginPath();
      ctx.arc(lx, ly, 2.3 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.stone, 0.78);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.58);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    if (owSanct.climbingKiln) {
      const kl = owSanct.climbingKiln;
      const kx = proj.px(kl.x, kl.z);
      const ky = proj.py(kl.x, kl.z);
      ctx.beginPath();
      ctx.ellipse(kx, ky, 3.1 * u, 1.8 * u, -(kl.rot || 0), 0, TAU);
      ctx.fillStyle = mixRgba(pal.roof, pal.seal, 0.25, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.65);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
    }
    for (const hut of [owSanct.deerHermitage, owSanct.mountainTeaHut, owSanct.woodcutterHut]) {
      if (!hut) continue;
      const hx = proj.px(hut.x, hut.z);
      const hy = proj.py(hut.x, hut.z);
      ctx.beginPath();
      ctx.rect(hx - 1.9 * u, hy - 1.5 * u, 3.8 * u, 3.0 * u);
      ctx.fillStyle = rgba(pal.roof, 0.86);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.64);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
    }
  }

  // 远坞三秘境（六条深坞山径、西南古社、北涧冷泉幽轩、东南碧涧茶坞与茶垄点染）
  const dh = (src.leisureGrove && src.leisureGrove.deepHollows) || src.deepHollows;
  if (dh) {
    for (const tr of dh.trails || []) {
      const pts = tr.points;
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(proj.px(pts[0][0], pts[0][1]), proj.py(pts[0][0], pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(proj.px(pts[i][0], pts[i][1]), proj.py(pts[i][0], pts[i][1]));
      const tw = (tr.width || 1.3) * proj.sx * 0.80;
      ctx.strokeStyle = rgba(pal.ink, 0.16);
      ctx.lineWidth = tw + 0.72 * u;
      ctx.stroke();
      ctx.strokeStyle = rgba(tr.kind === 'flagstone' ? pal.stone : pal.road, 0.86);
      ctx.lineWidth = tw;
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.ink, 0.24);
      ctx.lineWidth = 0.48 * u;
      ctx.stroke();
    }
    for (const pl of dh.pools || []) {
      const px = proj.px(pl.x, pl.z);
      const py = proj.py(pl.x, pl.z);
      ctx.beginPath();
      ctx.ellipse(px, py, Math.max(1.8, (pl.rx || 1.4) * proj.sx * 0.95), Math.max(1.5, (pl.rz || 1.2) * proj.sy * 0.95), 0, 0, TAU);
      ctx.fillStyle = rgba(pal.water, 0.86);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.waterEdge, 0.58);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    const dhSanct = dh.sanctuaries || {};
    const jtAnchor = dhSanct.jadeTeaTerrace || { x: 186, z: -114 };
    for (const tb of dh.teaSpots || []) {
      const tx = proj.px(tb[0], tb[1]);
      const ty = proj.py(tb[0], tb[1]);
      const ang = Math.atan2(ty - proj.py(jtAnchor.x, jtAnchor.z), tx - proj.px(jtAnchor.x, jtAnchor.z)) + Math.PI * 0.5;
      ctx.beginPath();
      ctx.ellipse(tx, ty, 2.2 * u, 1.05 * u, ang, 0, TAU);
      ctx.fillStyle = mixRgba(pal.crop, pal.bamboo, 0.30, 0.64);
      ctx.fill();
      ctx.strokeStyle = phenologyId === 'winter' ? rgba(pal.paper, 0.72) : rgba(pal.bamboo, 0.36);
      ctx.lineWidth = phenologyId === 'winter' ? 0.68 * u : 0.42 * u;
      ctx.stroke();
    }
    for (const cr of dh.cragSpots || []) {
      paintFacetCrag(ctx, proj.px(cr[0], cr[1]), proj.py(cr[0], cr[1]), (2.1 + r6Rand() * 1.0) * u, r6Rand() * TAU, pal, u, phenologyId);
    }
    if (dhSanct.ancientAltar) {
      const aa = dhSanct.ancientAltar;
      const ax = proj.px(aa.x, aa.z);
      const ay = proj.py(aa.x, aa.z);
      ctx.beginPath();
      ctx.rect(ax - 2.9 * u, ay - 2.9 * u, 5.8 * u, 5.8 * u);
      ctx.fillStyle = rgba(pal.stone, 0.78);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.55);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(ax - 1.7 * u, ay - 1.7 * u, 3.4 * u, 3.4 * u);
      ctx.fillStyle = rgba(pal.yard, 0.72);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.65);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
      const camphorTint = phenologyId === 'autumn'
        ? [mixRgba(pal.hay, pal.seal, 0.28, 0.62), mixRgba(pal.hay, pal.paper, 0.14, 0.52), mixRgba(pal.hay, pal.seal, 0.42, 0.66)]
        : null;
      paintHillPine(ctx, ax - 3.0 * u, ay + 0.5 * u, 2.9 * u, pal, r6Rand, phenologyId, camphorTint);
    }
    if (dhSanct.secludedStudy) {
      const ss = dhSanct.secludedStudy;
      const sx = proj.px(ss.x, ss.z);
      const sy = proj.py(ss.x, ss.z);
      ctx.beginPath();
      ctx.rect(sx - 2.8 * u, sy - 2.2 * u, 5.6 * u, 4.4 * u);
      ctx.fillStyle = rgba(pal.yard, 0.75);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(sx - 2.2 * u, sy - 1.8 * u, 4.4 * u, 3.6 * u);
      ctx.fillStyle = mixRgba(pal.roof, pal.ink, 0.22, 0.90);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.68);
      ctx.lineWidth = 0.65 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 1.4 * u, sy);
      ctx.lineTo(sx + 1.4 * u, sy);
      ctx.strokeStyle = rgba(pal.paper, 0.42);
      ctx.lineWidth = 0.5 * u;
      ctx.stroke();
    }
    if (dhSanct.jadeTeaTerrace) {
      const jt = dhSanct.jadeTeaTerrace;
      const jx = proj.px(jt.x, jt.z);
      const jy = proj.py(jt.x, jt.z);
      ctx.beginPath();
      ctx.arc(jx, jy, 3.2 * u, 0, TAU);
      ctx.fillStyle = rgba(pal.yard, 0.76);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.stone, 0.6);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(jx - 1.6 * u, jy - 1.4 * u, 3.2 * u, 2.8 * u);
      ctx.fillStyle = rgba(pal.roof, 0.90);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.65);
      ctx.lineWidth = 0.6 * u;
      ctx.stroke();
    }
  }

  // 春畴牛耕：翻耕熟土垄纹与耕牛憩处记号
  const ox = (src.leisureGrove && src.leisureGrove.oxPlowing) || src.oxPlowing;
  if (ox) {
    const plotCfg = ox.plowedPlot || oxPlowingCfg?.plowedPlot;
    const blk = plotCfg && world?.village?.fields?.blocks?.[plotCfg.block];
    if (blk && Array.isArray(blk.plot)) {
      const pw = blk.plot[0];
      const ph = blk.plot[1];
      const gap = blk.gap || 0;
      const wx0 = blk.x + plotCfg.col * (pw + gap) + 0.35;
      const wx1 = wx0 + pw - 0.7;
      const wz1 = blk.z - plotCfg.row * (ph + gap) - 0.35;
      const wz0 = wz1 - ph + 0.7;
      const sx0 = proj.px(wx0, wz0);
      const sx1 = proj.px(wx1, wz1);
      const sy0 = proj.py(wx1, wz1);
      const sy1 = proj.py(wx0, wz0);
      ctx.beginPath();
      ctx.rect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      ctx.fillStyle = mixRgba(pal.ink, pal.field, 0.55, 0.28);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.34);
      ctx.lineWidth = 0.5 * u;
      ctx.stroke();
      ctx.beginPath();
      for (let f = 1; f <= 4; f++) {
        const fy = sy0 + ((sy1 - sy0) * f) / 5;
        ctx.moveTo(sx0 + 0.7 * u, fy);
        ctx.lineTo(sx1 - 0.7 * u, fy);
      }
      ctx.strokeStyle = rgba(pal.ink, 0.28);
      ctx.lineWidth = 0.45 * u;
      ctx.stroke();
    }
    const oxAnchor = typeof ox.getRestAnchor === 'function' ? ox.getRestAnchor() : ox.targets?.[0];
    if (oxAnchor && Number.isFinite(oxAnchor.x) && Number.isFinite(oxAnchor.z)) {
      const ax = proj.px(oxAnchor.x, oxAnchor.z);
      const ay = proj.py(oxAnchor.x, oxAnchor.z);
      ctx.beginPath();
      ctx.arc(ax, ay, 0.9 * u, 0, TAU);
      ctx.fillStyle = mixRgba(pal.ink, pal.hay, 0.45, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 0.6);
      ctx.lineWidth = 0.45 * u;
      ctx.stroke();
    }
  }

  // 秦汉村落补完：晒场篝火石圈、门扉柴扉与黍稷熟田记号
  const qhc = (src.leisureGrove && src.leisureGrove.qinHanCompletion) || src.qinHanCompletion;
  if (qhc) {
    const feastState = typeof qhc.getNightFeastState === 'function' ? qhc.getNightFeastState() : qhc.hearth;
    if (feastState && Number.isFinite(feastState.x) && Number.isFinite(feastState.z)) {
      const fx = proj.px(feastState.x, feastState.z);
      const fy = proj.py(feastState.x, feastState.z);
      ctx.beginPath();
      ctx.arc(fx, fy, 1.35 * u, 0, TAU);
      ctx.strokeStyle = rgba(pal.stone || pal.ink, 0.78);
      ctx.lineWidth = 0.75 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, fy, 0.55 * u, 0, TAU);
      ctx.fillStyle = mixRgba(pal.seal, pal.hay, 0.35, 0.82);
      ctx.fill();
    }
    let gateDone = 0;
    for (const m of src.marks || []) {
      if (m.kind !== 'fence' || !(m.gap > 0.2) || gateDone >= 2) continue;
      gateDone++;
      const sp = frameOf(proj, m.x, m.z, m.rot || 0);
      const g0 = sp(-m.gap, m.front);
      const g1 = sp(-m.gap + m.gap * 0.85, m.front + m.gap * 0.45);
      ctx.beginPath();
      ctx.moveTo(g0[0], g0[1]);
      ctx.lineTo(g1[0], g1[1]);
      ctx.strokeStyle = rgba(pal.ink, 0.72);
      ctx.lineWidth = 0.85 * u;
      ctx.stroke();
    }
    const qTargets = qhc.targets || [];
    for (let i = 0; i < qTargets.length; i++) {
      const qt = qTargets[i];
      if (!qt || !Number.isFinite(qt.x) || !Number.isFinite(qt.z)) continue;
      if (qt.id === 'millet-field') {
        const mx = proj.px(qt.x, qt.z);
        const my = proj.py(qt.x, qt.z);
        ctx.beginPath();
        ctx.arc(mx, my, 1.15 * u, 0, TAU);
        ctx.fillStyle = rgba(pal.hay, 0.52);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.32);
        ctx.lineWidth = 0.45 * u;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// 把整张底图画出来（一次）
// ---------- 阡陌交通：田间三级路网（阡陌干道 + 田头支径 + 畦间小路 + 涵桥） ----------
function drawQianmoPaths(ctx, proj, cfg, src) {
  const qm = (src.leisureGrove && src.leisureGrove.qianmo) || src.qianmo;
  if (!qm || !qm.enabled) return;
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;

  ctx.save?.();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const tracePts = (pts) => {
    ctx.beginPath();
    ctx.moveTo(proj.px(pts[0][0], pts[0][1]), proj.py(pts[0][0], pts[0][1]));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(proj.px(pts[i][0], pts[i][1]), proj.py(pts[i][0], pts[i][1]));
    }
  };

  // Tier 3 畦间小路：细碎柔韧的田埂小道
  for (const ip of qm.interPlots || []) {
    if (!ip.points || ip.points.length < 2) continue;
    tracePts(ip.points);
    ctx.strokeStyle = mixRgba(pal.road, pal.paper, 0.24, 0.68);
    ctx.lineWidth = Math.max(0.85 * u, (ip.width || 0.62) * proj.sx * 0.92);
    ctx.stroke();

    ctx.setLineDash([1.6 * u, 2.2 * u]);
    tracePts(ip.points);
    ctx.strokeStyle = rgba(pal.ink, 0.22);
    ctx.lineWidth = 0.42 * u;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Tier 2 池畔桑园与屋桥支径
  for (const sp of qm.spurs || []) {
    if (!sp.points || sp.points.length < 2) continue;
    tracePts(sp.points);
    ctx.strokeStyle = mixRgba(pal.road, pal.paper, 0.16, 0.78);
    ctx.lineWidth = Math.max(1.15 * u, (sp.width || 1.04) * proj.sx * 0.85);
    ctx.stroke();

    ctx.strokeStyle = rgba(pal.ink, 0.24);
    ctx.lineWidth = 0.48 * u;
    ctx.stroke();
  }

  // Tier 1 阡陌干道（带淡淡车辙虚线与墨线边缘）
  for (const ar of qm.arteries || []) {
    if (!ar.points || ar.points.length < 2) continue;
    const lw = Math.max(1.45 * u, (ar.width || 1.38) * proj.sx * 0.84);
    tracePts(ar.points);
    ctx.strokeStyle = mixRgba(pal.road, pal.paper, 0.26, 0.56);
    ctx.lineWidth = lw + 1.8 * u;
    ctx.stroke();

    tracePts(ar.points);
    ctx.strokeStyle = rgba(pal.road, 0.84);
    ctx.lineWidth = lw;
    ctx.stroke();

    tracePts(ar.points);
    ctx.setLineDash([2.2 * u, 3.4 * u]);
    ctx.strokeStyle = rgba(pal.ink, 0.14);
    ctx.lineWidth = 0.65 * u;
    ctx.stroke();
    ctx.setLineDash([]);

    tracePts(ar.points);
    ctx.strokeStyle = rgba(pal.ink, 0.24);
    ctx.lineWidth = 0.50 * u;
    ctx.stroke();
  }

  // 沟渠小石涵 / 木栈涵微小记号
  for (const c of qm.culverts || []) {
    const cx = proj.px(c.x, c.z);
    const cy = proj.py(c.x, c.z);
    const r = 0.85 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = rgba(c.kind === 'plank' ? (pal.timber || pal.road) : pal.stone, 0.72);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.44);
    ctx.lineWidth = 0.4 * u;
    ctx.stroke();
  }
  ctx.restore?.();
}

function sampleSmoothRidge(knots, steps, wobbleSeed) {
  const pts = [];
  const kLast = knots.length - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = t * kLast;
    const idx = Math.min(kLast - 1, Math.floor(f));
    const u0 = f - idx;
    const s = 0.5 - 0.5 * Math.cos(u0 * Math.PI);
    const a = knots[idx];
    const b = knots[idx + 1];
    const wob = Math.sin(t * 21.0 + wobbleSeed) * 2.1 + Math.sin(t * 47.0 + wobbleSeed * 1.7) * 1.05;
    pts.push([a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * s + wob]);
  }
  return pts;
}

// ---------- 四周叠嶂与武陵云岚：借平远山水把手卷四周托起，而不挤占留白 ----------
function drawSurroundingHills(ctx, proj, cfg) {
  const pal = cfg.palette;
  const phenologyId = cfg.phenologyId || 'spring';
  const u = (proj.w / cfg.design) * 1.55;
  const pad = 48;

  const paintBandZ = (knots, skirtM, skirtDirY, fillMix, fillAlpha, ridgeAlpha, hatchAlpha, seed) => {
    const samples = sampleSmoothRidge(knots, 44, seed);
    const screenPts = samples.map(([wz, wx]) => [proj.px(wx, wz), proj.py(wx, wz)]);
    let anyIn = false;
    for (let i = 0; i < screenPts.length; i++) {
      if (screenPts[i][0] >= -pad && screenPts[i][0] <= proj.w + pad && screenPts[i][1] >= -pad && screenPts[i][1] <= proj.h + pad) {
        anyIn = true;
        break;
      }
    }
    if (!anyIn) return;
    const skirtPx = skirtM * proj.sy * skirtDirY;
    let gyEdge = screenPts[0][1];
    for (let i = 1; i < screenPts.length; i++) {
      gyEdge = skirtDirY > 0 ? Math.min(gyEdge, screenPts[i][1]) : Math.max(gyEdge, screenPts[i][1]);
    }
    const baseTop = phenologyId === 'summer'
      ? mixRgba(pal.mountain, pal.field, 0.18, fillAlpha)
      : mixRgba(pal.mountain, pal.mountainDeep, fillMix, fillAlpha);
    const grad = ctx.createLinearGradient(0, gyEdge, 0, gyEdge + skirtPx * 1.15);
    grad.addColorStop(0, baseTop);
    grad.addColorStop(0.55, mixRgba(pal.mountain, pal.paper, 0.35, fillAlpha * 0.55));
    grad.addColorStop(1, rgba(pal.paper, 0));

    ctx.beginPath();
    ctx.moveTo(screenPts[0][0], screenPts[0][1]);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i][0], screenPts[i][1]);
    for (let i = screenPts.length - 1; i >= 0; i--) {
      const f = 0.78 + 0.32 * Math.sin(i * 0.45 + seed);
      ctx.lineTo(screenPts[i][0], screenPts[i][1] + skirtPx * f);
    }
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    if (hatchAlpha > 0) {
      ctx.beginPath();
      for (let i = 2; i < screenPts.length - 1; i += 2) {
        const sx = screenPts[i][0];
        const sy = screenPts[i][1];
        const len = (8 + (i % 5) * 4.5) * u;
        ctx.moveTo(sx, sy + 0.8 * u);
        ctx.lineTo(sx + ((i % 3) - 1) * 3.5 * u, sy + skirtDirY * len);
      }
      ctx.strokeStyle = rgba(pal.ink, hatchAlpha);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(screenPts[0][0], screenPts[0][1]);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i][0], screenPts[i][1]);
    ctx.strokeStyle = rgba(pal.ink, ridgeAlpha);
    ctx.lineWidth = (ridgeAlpha > 0.2 ? 1.05 : 0.78) * u;
    ctx.stroke();

    if (phenologyId === 'winter') {
      ctx.beginPath();
      for (let i = 0; i < screenPts.length; i++) {
        const sy = screenPts[i][1] + skirtDirY * 1.15 * u;
        if (i === 0) ctx.moveTo(screenPts[i][0], sy); else ctx.lineTo(screenPts[i][0], sy);
      }
      ctx.strokeStyle = mixRgba(pal.paper, pal.cloth || pal.paper, 0.35, 0.76);
      ctx.lineWidth = (ridgeAlpha > 0.2 ? 1.7 : 1.2) * u;
      ctx.stroke();
      if (hatchAlpha > 0) {
        ctx.beginPath();
        for (let i = 3; i < screenPts.length - 2; i += 4) {
          const sx = screenPts[i][0];
          const sy = screenPts[i][1] + skirtDirY * (4.2 + (i % 3) * 2.2) * u;
          ctx.moveTo(sx - 4.0 * u, sy);
          ctx.lineTo(sx + 4.0 * u, sy + skirtDirY * 1.4 * u);
        }
        ctx.strokeStyle = rgba(pal.paper, 0.66);
        ctx.lineWidth = 0.9 * u;
        ctx.stroke();
      }
    }
  };

  const paintBandX = (knots, skirtM, fillMix, fillAlpha, ridgeAlpha, seed) => {
    const samples = sampleSmoothRidge(knots, 26, seed);
    const screenPts = samples.map(([wx, wz]) => [proj.px(wx, wz), proj.py(wx, wz)]);
    let minSx = screenPts[0][0];
    for (let i = 1; i < screenPts.length; i++) minSx = Math.min(minSx, screenPts[i][0]);
    const skirtPx = skirtM * proj.sx;
    const grad = ctx.createLinearGradient(minSx, 0, minSx + skirtPx * 1.15, 0);
    grad.addColorStop(0, mixRgba(pal.mountain, pal.mountainDeep, fillMix, fillAlpha));
    grad.addColorStop(0.55, mixRgba(pal.mountain, pal.paper, 0.40, fillAlpha * 0.50));
    grad.addColorStop(1, rgba(pal.paper, 0));

    ctx.beginPath();
    ctx.moveTo(screenPts[0][0], screenPts[0][1]);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i][0], screenPts[i][1]);
    for (let i = screenPts.length - 1; i >= 0; i--) {
      const f = 0.75 + 0.30 * Math.cos(i * 0.6 + seed);
      ctx.lineTo(screenPts[i][0] + skirtPx * f, screenPts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(screenPts[0][0], screenPts[0][1]);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i][0], screenPts[i][1]);
    ctx.strokeStyle = rgba(pal.ink, ridgeAlpha);
    ctx.lineWidth = 0.76 * u;
    ctx.stroke();

    if (phenologyId === 'winter') {
      ctx.beginPath();
      for (let i = 0; i < screenPts.length; i++) {
        const sx = screenPts[i][0] + 1.1 * u;
        if (i === 0) ctx.moveTo(sx, screenPts[i][1]); else ctx.lineTo(sx, screenPts[i][1]);
      }
      ctx.strokeStyle = mixRgba(pal.paper, pal.cloth || pal.paper, 0.35, 0.70);
      ctx.lineWidth = 1.2 * u;
      ctx.stroke();
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1) 武陵东岭（右上外山三重叠嶂，右下往左下渐变淡出，避开罗盘角）
  paintBandZ(
    [[-46, 184], [-6, 194], [40, 200], [88, 188], [136, 204], [184, 194], [228, 174], [262, 160], [295, 148]],
    48, 1, 0.16, 0.34, 0.17, 0.045, 1.1
  );
  paintBandZ(
    [[-54, 152], [-10, 166], [34, 156], [78, 174], [122, 162], [166, 176], [212, 156], [254, 144], [295, 130]],
    44, 1, 0.30, 0.42, 0.22, 0.065, 2.7
  );
  paintBandZ(
    [[-62, 118], [-22, 126], [18, 110], [64, 130], [108, 116], [156, 134], [202, 114], [248, 106], [295, 94]],
    36, 1, 0.42, 0.46, 0.26, 0.085, 4.3
  );

  // 2) 武陵西麓（右下外山三重叠嶂，上扬化岚，避开缩放按钮栏）
  paintBandZ(
    [[-46, -124], [-4, -138], [44, -146], [92, -132], [142, -148], [190, -136], [238, -120], [270, -110], [295, -104]],
    46, -1, 0.16, 0.34, 0.17, 0.045, 5.9
  );
  paintBandZ(
    [[-54, -102], [-10, -116], [36, -106], [84, -122], [130, -108], [176, -124], [224, -104], [262, -94], [295, -84]],
    42, -1, 0.30, 0.42, 0.22, 0.065, 7.2
  );
  paintBandZ(
    [[-64, -74], [-22, -84], [22, -70], [68, -88], [116, -74], [162, -90], [210, -70], [252, -62], [295, -56]],
    34, -1, 0.42, 0.46, 0.26, 0.085, 8.8
  );

  // 3) 桃源北西远岫微屏（最外缘极淡山影，托住四隅留白且不遮字与朱印）
  paintBandZ(
    [[-258, 195], [-210, 203], [-162, 192], [-114, 204], [-70, 190], [-42, 184]],
    32, 1, 0.12, 0.26, 0.14, 0.0, 10.4
  );
  paintBandZ(
    [[-282, -140], [-232, -149], [-182, -136], [-134, -150], [-88, -136], [-42, -124]],
    32, -1, 0.12, 0.26, 0.14, 0.0, 12.1
  );
  paintBandX(
    [[194, -314], [158, -304], [122, -313], [88, -300]],
    38, 0.10, 0.24, 0.13, 14.3
  );
  paintBandX(
    [[36, -314], [4, -302], [-28, -314], [-62, -298], [-96, -312], [-128, -302]],
    40, 0.10, 0.25, 0.13, 16.7
  );

  ctx.restore();
}

function drawExteriorLandscapeAccents(ctx, proj, cfg) {
  const pal = cfg.palette;
  const phenologyId = cfg.phenologyId || 'spring';
  const u = (proj.w / cfg.design) * 1.55;
  const rand = lcg(88429);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1) 武陵溪外山麓松杉簇（点染右上与右下山坡，避开河道、罗盘与按钮区）
  const bands = [
    { xMin: 74, xMax: 144, zMin: -8, zMax: 274, count: 44 },
    { xMin: -116, xMax: -50, zMin: -8, zMax: 268, count: 36 }
  ];
  for (let b = 0; b < bands.length; b++) {
    const bd = bands[b];
    for (let i = 0; i < bd.count; i++) {
      const z = bd.zMin + rand() * (bd.zMax - bd.zMin);
      const x = bd.xMin + rand() * (bd.xMax - bd.xMin);
      const rM = (1.6 + rand() * 0.9) * proj.sx;
      if (z > 240 && x > 136) continue;
      if (z > 202 && x < -104) continue;
      const px = proj.px(x, z);
      const py = proj.py(x, z);
      if (px < -16 || px > proj.w + 16 || py < -16 || py > proj.h + 16) continue;
      paintHillPine(ctx, px, py, rM, pal, rand, phenologyId);
    }
  }

  // 2) 武陵溪外沙洲芦渚与岸畔青石
  const rocks = [
    [14, 152, 2.3], [36, 174, 2.6], [10, 218, 2.4], [40, 246, 2.7],
    [-4, 88, 2.1], [28, 66, 2.2], [44, 118, 2.0], [18, 276, 2.5]
  ];
  for (let i = 0; i < rocks.length; i++) {
    const rk = rocks[i];
    const px = proj.px(rk[0], rk[1]);
    const py = proj.py(rk[0], rk[1]);
    if (px < -12 || px > proj.w + 12 || py < -12 || py > proj.h + 12) continue;
    paintFacetCrag(ctx, px, py, rk[2] * u, rand() * TAU, pal, u, phenologyId);
  }

  // 3) 四候风物点睛：春落英、夏荷蕊、秋红枫、冬雪霰
  const sRand = lcg(91337);
  if (phenologyId === 'winter') {
    for (let i = 0; i < 38; i++) {
      const z = -290 + sRand() * 560;
      const x = -140 + sRand() * 335;
      if (z > 235 && x > 135) continue;
      if (z > 200 && x < -100) continue;
      const px = proj.px(x, z);
      const py = proj.py(x, z);
      if (px < 8 || px > proj.w - 8 || py < 8 || py > proj.h - 8) continue;
      ctx.beginPath();
      ctx.arc(px, py, (0.75 + sRand() * 0.7) * u, 0, TAU);
      ctx.fillStyle = rgba(pal.paper, 0.78);
      ctx.fill();
    }
  } else if (phenologyId === 'autumn') {
    for (let i = 0; i < 28; i++) {
      const z = -6 + sRand() * 265;
      const x = (i % 2 === 0 ? 78 + sRand() * 72 : -118 + sRand() * 68);
      if (z > 235 && x > 135) continue;
      if (z > 200 && x < -100) continue;
      const px = proj.px(x, z);
      const py = proj.py(x, z);
      if (px < 10 || px > proj.w - 10 || py < 10 || py > proj.h - 10) continue;
      const r = (1.5 + sRand() * 0.9) * u;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(px + (k ? r * 0.35 : -r * 0.25), py + (k ? -r * 0.2 : r * 0.15), r * 0.75, 0, TAU);
        ctx.fillStyle = mixRgba(pal.seal, pal.hay, k === 0 ? 0.32 : 0.48, 0.56);
        ctx.fill();
      }
    }
  } else if (phenologyId === 'summer') {
    const lotusSpots = [
      [18, 168], [32, 186], [20, 224], [34, 248], [14, 96], [28, 72],
      [12, 134], [30, 148], [16, 206], [26, 266], [8, 42], [22, 58]
    ];
    for (let i = 0; i < lotusSpots.length; i++) {
      const ls = lotusSpots[i];
      const px = proj.px(ls[0], ls[1]);
      const py = proj.py(ls[0], ls[1]);
      if (px < 8 || px > proj.w - 8 || py < 8 || py > proj.h - 8) continue;
      ctx.beginPath();
      ctx.arc(px, py, (0.95 + sRand() * 0.35) * u, 0, TAU);
      ctx.fillStyle = rgba(pal.lotus, 0.68);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 24; i++) {
      const z = -8 + sRand() * 260;
      const x = -28 + sRand() * 82;
      const px = proj.px(x, z);
      const py = proj.py(x, z);
      if (px < 8 || px > proj.w - 8 || py < 8 || py > proj.h - 8) continue;
      ctx.beginPath();
      ctx.ellipse(px, py, (1.1 + sRand() * 0.45) * u, 0.62 * u, sRand() * TAU, 0, TAU);
      ctx.fillStyle = rgba(pal.peachDeep, 0.52);
      ctx.fill();
    }
  }

  // 3) 山腰飘渺淡岚云带：柔化山脚接纸处的呼吸感
  const mists = [
    [98, 92, 54, 14], [122, 206, 62, 16], [-78, 108, 52, 14],
    [-92, 224, 58, 15], [148, -142, 48, 13], [-108, -196, 46, 13]
  ];
  for (let i = 0; i < mists.length; i++) {
    const m = mists[i];
    const mx = proj.px(m[0], m[1]);
    const my = proj.py(m[0], m[1]);
    const r = m[2] * proj.sx;
    if (mx < -r || mx > proj.w + r || my < -r || my > proj.h + r) continue;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(1, (m[3] / m[2]));
    const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
    grad.addColorStop(0, rgba(pal.paper, 0.36));
    grad.addColorStop(0.55, rgba(pal.paper, 0.16));
    grad.addColorStop(1, rgba(pal.paper, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 4) 远岫归雁数点（右上清岚空隙）
  const geese = [
    [152, 178, 1.0], [159, 186, 0.9], [146, 191, 0.85], [154, 201, 0.8], [161, 211, 0.75]
  ];
  ctx.strokeStyle = rgba(pal.ink, 0.28);
  ctx.lineWidth = 0.75 * u;
  ctx.beginPath();
  for (let i = 0; i < geese.length; i++) {
    const g = geese[i];
    const gx = proj.px(g[0], g[1]);
    const gy = proj.py(g[0], g[1]);
    if (gx < 10 || gx > proj.w - 10 || gy < 10 || gy > proj.h - 10) continue;
    const s = 3.2 * u * g[2];
    ctx.moveTo(gx - s, gy - s * 0.25);
    ctx.quadraticCurveTo(gx - s * 0.35, gy - s * 0.65, gx, gy);
    ctx.quadraticCurveTo(gx + s * 0.35, gy - s * 0.65, gx + s, gy - s * 0.25);
  }
  ctx.stroke();

  ctx.restore();
}

export function paintBase(ctx, proj, cfg, world, src) {
  const rand = lcg(20261108);
  const rand2 = lcg(77213);
  drawPaper(ctx, proj, cfg, rand);
  drawRelief(ctx, proj, cfg, src.field, world);
  drawContours(ctx, proj, cfg, src.field, world);
  drawSurroundingHills(ctx, proj, cfg);
  drawMeadow(ctx, proj, cfg, src, rand2, world);
  drawGroves(ctx, proj, cfg, src.spots, rand2, src.field, world);
  drawWall(ctx, proj, cfg, world);
  drawRiver(ctx, proj, cfg, world, src.spine);
  drawExteriorLandscapeAccents(ctx, proj, cfg);
  drawExterior(ctx, proj, cfg, src);
  drawBoats(ctx, proj, cfg, world);
  drawPond(ctx, proj, cfg, world, src);
  drawFields(ctx, proj, cfg, world);
  drawQianmoPaths(ctx, proj, cfg, src);
  drawRoad(ctx, proj, cfg, world);
  drawVillageGround(ctx, proj, cfg, world, src.houseInfo, src.marks);
  drawYards(ctx, proj, cfg, src.marks, src.houseInfo);
  drawSpurs(ctx, proj, cfg, src.houseInfo);
  drawThresh(ctx, proj, cfg, src.marks);
  drawBamboo(ctx, proj, cfg, world, src, src.marks);
  drawMulberry(ctx, proj, cfg, src);
  drawHinterland(ctx, proj, cfg, src);
  drawVillageScenes(ctx, proj, cfg, src);
  drawVillageLife(ctx, proj, cfg, src);
  drawRound6Landmarks(ctx, proj, cfg, src, world);
  drawHouses(ctx, proj, cfg, src.houseInfo);
  drawChimneys(ctx, proj, cfg, src.chimneys);
  drawPropMarks(ctx, proj, cfg, src.marks);
  drawFauna(ctx, proj, cfg, world, rand2);
  drawFigures(ctx, proj, cfg, world);
}

// ---------- 山带：外圈的石壁与山口 ----------
// 山是转着面看的：把崖环切成一块块小石面，按受光方向各自上色，
// 同色块之间留一道墨缝。低多边形的山，比一层灰雾更像石头。
function drawWall(ctx, proj, cfg, world) {
  const u = (proj.w / cfg.design) * 1.55;
  const pal = cfg.palette;
  const wc = cfg.wall;
  const c = world.cliff;
  if (!c) return;
  const cx = c.center[0];
  const cz = c.center[1];
  const R = c.radius;
  const slitA = Math.atan2(c.slit[1] - cz, c.slit[0] - cx);
  const segs = [[c.arcFrom, slitA - wc.gap], [slitA + wc.gap, c.arcTo]];
  const rand = lcg(4471);
  const at = function (ang, rad) {
    const wx = cx + Math.cos(ang) * rad;
    const wz = cz + Math.sin(ang) * rad;
    return [proj.px(wx, wz), proj.py(wx, wz)];
  };
  const ink = pal.ink;
  const stone = pal.mountainDeep;
  // 光来的方向（世界角）：西北
  const lightA = -2.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 山体：先铺一块不透光的石面（把底下的等高线、坡色全盖住），
  // 再在上面做受光的岩块、皴笔、山脚碎岩。
  // 早先版本用半透明灰带，结果底下的等高线透上来，整条山读成河。
  const stepM = 1.15;
  const bands = [0, 0.5, 1];
  for (let s = 0; s < segs.length; s++) {
    const a = segs[s][0];
    const b = segs[s][1];
    const span = b - a;
    if (span < 0.02) continue;
    const steps2 = Math.max(90, Math.round((R * span) / stepM));
    const angAt = function (i) { return a + span * (i / steps2); };
    const nPeak = 4 + Math.floor(rand() * 3);
    const peaks = [];
    for (let k = 0; k < nPeak; k++) {
      peaks.push({ p: 0.06 + rand() * 0.88, w: 0.05 + rand() * 0.09, h: 0.45 + rand() * 0.55 });
    }
    const prof = new Array(steps2 + 1);
    const foot = new Array(steps2 + 1);
    const ridge = new Array(steps2 + 1);
    for (let i = 0; i <= steps2; i++) {
      const t = i / steps2;
      let h = 0;
      for (let k = 0; k < peaks.length; k++) {
        const d = (t - peaks[k].p) / peaks[k].w;
        const g = peaks[k].h * Math.exp(-d * d);
        if (g > h) h = g;
      }
      h += 0.05 * Math.sin(t * 37) + 0.04 * Math.sin(t * 91);
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      prof[i] = h;
      foot[i] = R - wc.inner - h * 5.0 + 1.7 * Math.sin(t * 23.7) + 1.1 * Math.sin(t * 61.3 + 1.2);
      ridge[i] = R + 2.0 + h * wc.peak;
    }
    // 远山：脊后再退一排更淡的峰，只在垭口露头，山才有两重
    const farPeaks = [];
    const nFar = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < nFar; k++) {
      farPeaks.push({ p: rand(), w: 0.08 + rand() * 0.12, h: 0.4 + rand() * 0.6 });
    }
    const far = new Array(steps2 + 1);
    for (let i = 0; i <= steps2; i++) {
      const t = i / steps2;
      let h2 = 0;
      for (let k = 0; k < farPeaks.length; k++) {
        const d = (t - farPeaks[k].p) / farPeaks[k].w;
        const g = farPeaks[k].h * Math.exp(-d * d);
        if (g > h2) h2 = g;
      }
      far[i] = ridge[i] + 4.5 + h2 * wc.peak * 0.75;
    }
    const radAt = function (i, f) { return foot[i] + (ridge[i] - foot[i]) * f; };
    // 0) 远山带：从近脊向后再铺一条淡峰
    ctx.beginPath();
    for (let i = 0; i <= steps2; i++) {
      const q = at(angAt(i), ridge[i]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    for (let i = steps2; i >= 0; i--) {
      const q = at(angAt(i), far[i]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.fillStyle = mixRgba(pal.mountain, pal.paper, 0.76, 1);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= steps2; i++) {
      const q = at(angAt(i), far[i]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(ink, 0.14);
    ctx.lineWidth = 0.8 * u;
    ctx.stroke();
    // 1) 山脚往外三圈淡边，让山脚化进纸里，不是一刀切
    for (let g = 0; g < 3; g++) {
      const off = 2.6 + g * 3.2;
      ctx.beginPath();
      for (let i = 0; i <= steps2; i++) {
        const q = at(angAt(i), foot[i] - off);
        if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      }
      for (let i = steps2; i >= 0; i--) {
        const q = at(angAt(i), foot[i] - off + 3.0);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.closePath();
      ctx.fillStyle = mixRgba(pal.mountain, pal.paper, 0.5, [0.42, 0.24, 0.1][g]);
      ctx.fill();
    }
    // 2) 不透光石面：从山脚到山脊
    ctx.beginPath();
    for (let i = 0; i <= steps2; i++) {
      const q = at(angAt(i), foot[i]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    for (let i = steps2; i >= 0; i--) {
      const q = at(angAt(i), ridge[i]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.fillStyle = mixRgba(pal.mountain, pal.paper, 0.46, 1);
    ctx.fill();
    // 背光半坡：靠脊的一半压一层淡墨，山才有阴影面
    for (let i = 0; i < steps2; i++) {
      const ang = angAt(i);
      const lit = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.cos(ang - lightA)));
      if (lit > 0.62) continue;
      const p00 = at(angAt(i), radAt(i, 0.42));
      const p10 = at(angAt(i + 1), radAt(i + 1, 0.42));
      const p11 = at(angAt(i + 1), radAt(i + 1, 1));
      const p01 = at(angAt(i), radAt(i, 1));
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]);
      ctx.lineTo(p10[0], p10[1]);
      ctx.lineTo(p11[0], p11[1]);
      ctx.lineTo(p01[0], p01[1]);
      ctx.closePath();
      ctx.fillStyle = rgba(ink, 0.05 + (1 - lit) * 0.12);
      ctx.fill();
    }
    // 3) 受光/背光的小岩块：西北来光，东坡暗
    for (let i = 0; i < steps2; i++) {
      const ang = angAt(i);
      const lit = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.cos(ang - lightA)));
      for (let q = 0; q < bands.length - 1; q++) {
        const f0 = bands[q];
        const f1 = bands[q + 1];
        const p00 = at(angAt(i), radAt(i, f0));
        const p10 = at(angAt(i + 1), radAt(i + 1, f0));
        const p11 = at(angAt(i + 1), radAt(i + 1, f1));
        const p01 = at(angAt(i), radAt(i, f1));
        let tone = (1 - lit) * 0.76 + f1 * 0.2 + (rand() - 0.5) * 0.34;
        tone = Math.min(1, Math.max(0, tone));
        ctx.beginPath();
        ctx.moveTo(p00[0], p00[1]);
        ctx.lineTo(p10[0], p10[1]);
        ctx.lineTo(p11[0], p11[1]);
        ctx.lineTo(p01[0], p01[1]);
        ctx.closePath();
        ctx.fillStyle = mixRgba(stone, ink, 0.3 * tone, 0.12 + 0.42 * tone);
        ctx.fill();
        if (tone > 0.24) {
          ctx.strokeStyle = rgba(ink, 0.04 + 0.1 * tone);
          ctx.lineWidth = 0.4 * u;
          ctx.stroke();
        }
      }
    }
    // 4) 皴：从山脊往下拉的长笔，笔头压在脊线里
    for (let i = 2; i < steps2; i += 2) {
      const r0 = ridge[i] - 0.6 - rand() * 1.6;
      const r1 = r0 - (ridge[i] - foot[i]) * (0.34 + rand() * 0.5);
      const q0 = at(angAt(i), r0);
      const q1 = at(angAt(i) + (rand() - 0.5) * 0.006, r1);
      ctx.beginPath();
      ctx.moveTo(q0[0], q0[1]);
      ctx.lineTo(q1[0], q1[1]);
      ctx.strokeStyle = rgba(ink, 0.05 + rand() * 0.08);
      ctx.lineWidth = 0.55 * u;
      ctx.stroke();
    }
    // 5) 山脊：峰处重、垭口轻（冬雪则沿脊缀一条微白雪线）
    ctx.beginPath();
    for (let i = 0; i <= steps2; i++) {
      const q = at(angAt(i), ridge[i]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = mixRgba(stone, ink, 0.58, 0.5);
    ctx.lineWidth = 1.25 * u;
    ctx.stroke();
    if ((cfg.phenologyId || 'spring') === 'winter') {
      ctx.beginPath();
      for (let i = 0; i <= steps2; i++) {
        const q = at(angAt(i), ridge[i] - 1.2);
        if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      }
      ctx.strokeStyle = mixRgba(pal.paper, pal.cloth || pal.paper, 0.3, 0.78);
      ctx.lineWidth = 1.75 * u;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 4; i < steps2 - 3; i += 6) {
        const q0 = at(angAt(i), ridge[i] - 3.6);
        const q1 = at(angAt(i + 2), ridge[i + 2] - 4.4);
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
      }
      ctx.strokeStyle = rgba(pal.paper, 0.68);
      ctx.lineWidth = 1.05 * u;
      ctx.stroke();
    }
    // 6) 山脚：碎石三角 + 断续的暗边
    for (let i = 0; i < steps2; i++) {
      const q0 = at(angAt(i), foot[i]);
      const q1 = at(angAt(i + 1), foot[i + 1]);
      if (i % 9 === 0) {
        const w0 = 1.2 + rand() * 2.6;
        const tip = at(angAt(i) - 0.004, foot[i] - w0);
        ctx.beginPath();
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.closePath();
        ctx.fillStyle = mixRgba(stone, ink, 0.2, 0.28);
        ctx.fill();
      }
      if (i % 7 === 0 && rand() < 0.45) continue;
      ctx.beginPath();
      ctx.moveTo(q0[0], q0[1]);
      ctx.lineTo(q1[0], q1[1]);
      ctx.strokeStyle = rgba(ink, 0.24);
      ctx.lineWidth = 0.85 * u;
      ctx.stroke();
    }
    // 7) 山口：两侧各断一笔，崖口是切开的
    const angG = s === 0 ? slitA - wc.gap : slitA + wc.gap;
    const g0 = at(angG, foot[0] - 1);
    const g1 = at(angG, ridge[0] + 2);
    ctx.beginPath();
    ctx.moveTo(g0[0], g0[1]);
    ctx.lineTo(g1[0], g1[1]);
    ctx.strokeStyle = mixRgba(stone, ink, 0.5, 0.32);
    ctx.lineWidth = 1.0 * u;
    ctx.stroke();
  }
  // 洞：从口子往里的那一段暗线
  const dirX = Math.cos(slitA);
  const dirZ = Math.sin(slitA);
  const mouthX = cx + dirX * R;
  const mouthZ = cz + dirZ * R;
  const len = 9;
  const x0 = proj.px(mouthX, mouthZ);
  const y0 = proj.py(mouthX, mouthZ);
  const x1 = proj.px(mouthX - dirX * len, mouthZ - dirZ * len);
  const y1 = proj.py(mouthX - dirX * len, mouthZ - dirZ * len);
  ctx.strokeStyle = rgba(pal.ink, 0.42);
  ctx.lineWidth = 2.6 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = rgba(pal.paper, 0.55);
  ctx.lineWidth = 0.9 * u;
  ctx.setLineDash([2.2 * u, 2.4 * u]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}
