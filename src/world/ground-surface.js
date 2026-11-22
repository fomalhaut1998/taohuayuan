import { habitatSurface } from './habitat-details.js';
import { chaikinSmooth, resamplePolyline } from './road-geometry.js';

/**
 * 零分配实景地表高度采样器：
 * 综合三角网精确地形（habitatSurface）、村落主街与门前支路抬升拱度、屋基暗影垫、
 * 晒谷坪高台、阡陌田道与石木涵桥、后山小径与外山步道、良田及耕作翻土层高度，
 * 使行走的人物与动物鞋底/爪蹄贴合真实可见路面，不再陷入路面或田垄网格之下。
 */
export function sampleGroundSurface(field, x, z) {
  if (!field) return 0;
  if (typeof field.walkSurface === 'function') return field.walkSurface(x, z);
  if (field.heights && Number.isFinite(field.segments)) return habitatSurface(field, x, z);
  return typeof field.sample === 'function' ? field.sample(x, z) : 0;
}

export function sampleGroundMaterial(field, x, z) {
  if (field && typeof field.surfaceMaterial === 'function') return field.surfaceMaterial(x, z);
  return 'grass';
}

function matRank(material) {
  if (material === 'wood') return 3;
  if (material === 'stone') return 2;
  if (material === 'dirt') return 1;
  return 0;
}

function baseTerrainY(field, x, z) {
  if (!field) return 0;
  if (field.heights && Number.isFinite(field.segments)) return habitatSurface(field, x, z);
  return typeof field.sample === 'function' ? field.sample(x, z) : 0;
}

function buildRibbonEntry(rawPoints, opts) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) return null;
  const normRaw = rawPoints.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p?.x, p?.z])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (normRaw.length < 2) return null;
  const smoothPasses = opts.smoothPasses ?? 2;
  const sampleStep = opts.sampleStep ?? 1.05;
  const smoothed = smoothPasses > 0 ? chaikinSmooth(normRaw, smoothPasses) : normRaw;
  const pts = resamplePolyline(smoothed, sampleStep);
  if (pts.length < 2) return null;
  const hw = Math.max(0.15, opts.halfWidth ?? 0.75);
  const verge = Math.max(0.08, opts.vergeWidth ?? 0.24);
  const outer = hw + verge;
  const lift = opts.lift ?? 0.02;
  const camber = opts.camber ?? 0.015;
  const useHighTread = opts.useHighTread !== false;

  const n = pts.length;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const pt = pts[i];
    const x = Array.isArray(pt) ? pt[0] : pt.x;
    const z = Array.isArray(pt) ? pt[1] : pt.z;
    px[i] = x;
    pz[i] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const material = opts.material || 'dirt';
  const matOuter = hw + verge * 0.45;
  return {
    px,
    pz,
    n,
    hw,
    verge,
    outer,
    outerSq: outer * outer,
    matOuterSq: matOuter * matOuter,
    material,
    rank: matRank(material),
    lift,
    camber,
    useHighTread,
    minX: minX - outer,
    maxX: maxX + outer,
    minZ: minZ - outer,
    maxZ: maxZ + outer
  };
}

function evalRibbonHit(r, x, z) {
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return false;
  const maxD2 = r.matOuterSq;
  const px = r.px, pz = r.pz, n = r.n;
  for (let i = 0; i < n - 1; i++) {
    const ax = px[i], az = pz[i];
    const dx = px[i + 1] - ax, dz = pz[i + 1] - az;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-8) continue;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const ex = x - (ax + dx * t);
    const ez = z - (az + dz * t);
    if (ex * ex + ez * ez <= maxD2) return true;
  }
  return false;
}

function evalRibbonHeight(r, field, x, z, baseY) {
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return -Infinity;
  let bestD2 = r.outerSq;
  let bestCx = 0, bestCz = 0, bestNx = 0, bestNz = 0;
  let hit = false;
  const px = r.px, pz = r.pz, n = r.n;
  for (let i = 0; i < n - 1; i++) {
    const ax = px[i], az = pz[i];
    const dx = px[i + 1] - ax, dz = pz[i + 1] - az;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-8) continue;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const ex = x - cx, ez = z - cz;
    const d2 = ex * ex + ez * ez;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestCx = cx;
      bestCz = cz;
      const invL = 1 / Math.sqrt(l2);
      bestNx = -dz * invL;
      bestNz = dx * invL;
      hit = true;
    }
  }
  if (!hit) return -Infinity;

  const d = Math.sqrt(bestD2);
  let treadBase = field.sample(bestCx, bestCz);
  if (r.useHighTread) {
    const ly = field.sample(bestCx - bestNx * r.hw, bestCz - bestNz * r.hw);
    const ry = field.sample(bestCx + bestNx * r.hw, bestCz + bestNz * r.hw);
    if (ly > treadBase) treadBase = ly;
    if (ry > treadBase) treadBase = ry;
  }
  const edgeY = treadBase + r.lift;
  if (d <= r.hw) {
    const u = d / r.hw;
    return edgeY + r.camber * (1 - u * u);
  }
  const v = (d - r.hw) / r.verge;
  const s = v * v * (3 - 2 * v);
  return edgeY * (1 - s) + baseY * s;
}

function evalBridgeHeight(b, x, z, baseY) {
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return -Infinity;
  const dx = x - b.x;
  const dz = z - b.z;
  const along = dx * b.tx + dz * b.tz;
  const absAlong = Math.abs(along);
  const across = Math.abs(dx * b.ux + dz * b.uz);
  if (absAlong > b.halfL + b.bevelL || across > b.halfW + b.bevelW) return -Infinity;
  let u = along / b.halfL;
  if (u < -1) u = -1;
  else if (u > 1) u = 1;
  const t01 = (u + 1) * 0.5;
  const deckY = b.endY0 * (1 - t01) + b.endY1 * t01 + b.arch * (1 - u * u);
  if (absAlong <= b.halfL && across <= b.halfW) return deckY;
  const ol = absAlong > b.halfL ? (absAlong - b.halfL) / b.bevelL : 0;
  const ow = across > b.halfW ? (across - b.halfW) / b.bevelW : 0;
  const blend = Math.min(1, Math.hypot(ol, ow));
  const s = blend * blend * (3 - 2 * blend);
  return deckY * (1 - s) + baseY * s;
}

export function attachGroundSurface(field, initial = {}) {
  const ribbons = [];
  const rotPads = [];
  const discs = [];
  const aabbPads = [];
  const bridges = [];
  const addedKeys = new Set();

  function addBridge(spec) {
    if (!spec || !Number.isFinite(spec.x) || !Number.isFinite(spec.z)) return;
    const halfL = Math.max(0.2, spec.halfL || 1.0);
    const halfW = Math.max(0.2, spec.halfW || 0.6);
    const bevelL = Math.max(0.05, spec.bevelL ?? 0.35);
    const bevelW = Math.max(0.05, spec.bevelW ?? 0.20);
    const tLen = Math.hypot(spec.tx || 0, spec.tz || 0) || 1;
    const tx = (spec.tx || 0) / tLen;
    const tz = (spec.tz || 0) / tLen;
    const uLen = Math.hypot(spec.ux || 0, spec.uz || 0);
    const ux = uLen > 1e-5 ? spec.ux / uLen : -tz;
    const uz = uLen > 1e-5 ? spec.uz / uLen : tx;
    const rad = Math.hypot(halfL + bevelL, halfW + bevelW);
    const material = spec.material || 'wood';
    bridges.push({
      x: spec.x,
      z: spec.z,
      tx,
      tz,
      ux,
      uz,
      halfL,
      halfW,
      bevelL,
      bevelW,
      endY0: spec.endY0,
      endY1: spec.endY1,
      arch: spec.arch || 0,
      material,
      rank: matRank(material),
      minX: spec.x - rad,
      maxX: spec.x + rad,
      minZ: spec.z - rad,
      maxZ: spec.z + rad
    });
  }

  function addOnce(key, fn) {
    if (addedKeys.has(key)) return;
    addedKeys.add(key);
    fn();
  }

  function register(layers = {}) {
    const { world, village, props, exterior, leisureGrove, oxPlowing, qianmoPaths, valleyBorderlands, outerWilds, deepHollows, wulingOutskirts } = layers;

    if (world?.village?.road?.points) {
      addOnce('village-road', () => {
        const rd = world.village.road;
        const entry = buildRibbonEntry(rd.points, {
          halfWidth: (rd.width || 3.6) * 0.5,
          vergeWidth: 0.30,
          lift: (rd.lift || 0.055) + 0.014,
          camber: 0.022,
          sampleStep: 1.10,
          smoothPasses: 2,
          useHighTread: true
        });
        if (entry) ribbons.push(entry);
      });
    }

    if (village?.houseInfo && world?.village) {
      addOnce('village-houses-spurs', () => {
        const rdLift = world.village.road?.lift || 0.055;
        const spCfg = world.village.spur || {};
        const nMain = world.village.houses?.count || 8;
        for (let i = 0; i < village.houseInfo.length; i++) {
          const hi = village.houseInfo[i];
          const c = Math.cos(hi.rot || 0);
          const s = Math.sin(hi.rot || 0);
          const hw = (hi.w || 6.4) * 0.5 + 0.55;
          const hd = (hi.d || 5.0) * 0.5 + 0.55;
          const rad = Math.hypot(hw, hd);
          rotPads.push({
            x: hi.x,
            z: hi.z,
            c,
            s,
            hw,
            hd,
            bevel: 0.25,
            y: hi.gy + 0.021,
            material: 'stone',
            rank: 2,
            minX: hi.x - rad,
            maxX: hi.x + rad,
            minZ: hi.z - rad,
            maxZ: hi.z + rad
          });
          if (hi.spur?.pts?.length >= 2) {
            const isBack = i >= nMain;
            const entry = buildRibbonEntry(hi.spur.pts, {
              halfWidth: isBack ? (spCfg.laneWidth || 1.55) : (spCfg.width || 0.62),
              vergeWidth: isBack ? 0.28 : 0.22,
              lift: rdLift + (isBack ? 0.002 : -0.004),
              camber: isBack ? 0.028 : 0.012,
              sampleStep: isBack ? 1.05 : 0.95,
              smoothPasses: 2,
              useHighTread: true
            });
            if (entry) ribbons.push(entry);
          }
        }
      });
    }

    if (world?.village?.fields?.blocks) {
      addOnce('village-fields', () => {
        const fCfg = world.village.fields;
        const fLift = fCfg.lift || 0.03;
        for (let bi = 0; bi < fCfg.blocks.length; bi++) {
          const blk = fCfg.blocks[bi];
          const pw = blk.plot[0], ph = blk.plot[1];
          for (let r = 0; r < blk.rows; r++) {
            for (let c = 0; c < blk.cols; c++) {
              const x0 = blk.x + c * (pw + blk.gap);
              const z0 = blk.z - r * (ph + blk.gap);
              const cy = field.sample(x0 + pw * 0.5, z0 - ph * 0.5) + fLift + 0.022;
              aabbPads.push({
                minX: x0,
                maxX: x0 + pw,
                minZ: z0 - ph,
                maxZ: z0,
                y: cy,
                relativeOffset: 0
              });
            }
          }
        }
      });
    }

    if (oxPlowing && world?.village?.fields?.blocks) {
      addOnce('ox-plowing-plot', () => {
        const blk = world.village.fields.blocks[0];
        if (blk) {
          const pw = blk.plot[0], ph = blk.plot[1];
          const x0 = blk.x + 2 * (pw + blk.gap);
          const z0 = blk.z - 1 * (ph + blk.gap);
          const fLift = world.village.fields.lift || 0.03;
          aabbPads.push({
            minX: x0 - 0.15,
            maxX: x0 + pw + 0.15,
            minZ: z0 - ph - 0.15,
            maxZ: z0 + 0.15,
            y: -Infinity,
            relativeOffset: fLift + 0.036
          });
        }
      });
    }

    if (props?.marks) {
      addOnce('props-thresh', () => {
        for (let i = 0; i < props.marks.length; i++) {
          const m = props.marks[i];
          if (m.kind !== 'thresh') continue;
          const r = m.r || 6.4;
          const gy = Number.isFinite(m.y) ? m.y : field.sample(m.x, m.z);
          discs.push({
            x: m.x,
            z: m.z,
            r,
            rSq: r * r,
            bevel: 0.35,
            rOuterSq: (r + 0.35) * (r + 0.35),
            y: gy + 0.125,
            material: 'dirt',
            rank: 1
          });
        }
      });
    }

    if (world?.hinterland?.paths) {
      addOnce('hinterland-paths', () => {
        const pLift = world.hinterland.pathLift || 0.075;
        for (const p of world.hinterland.paths) {
          const entry = buildRibbonEntry(p.points, {
            halfWidth: (p.width || 1.5) * 0.5,
            vergeWidth: 0.24,
            lift: pLift,
            camber: 0.018,
            sampleStep: 1.0,
            smoothPasses: 2,
            useHighTread: true
          });
          if (entry) ribbons.push(entry);
        }
      });
    }

    if (qianmoPaths?.layout?.enabled) {
      addOnce('qianmo-paths', () => {
        const ql = qianmoPaths.layout;
        for (const a of ql.arteries || []) {
          const entry = buildRibbonEntry(a.points, {
            halfWidth: (a.width || 1.4) * 0.5,
            vergeWidth: a.id === 'qian-mid-north' ? 0.14 : 0.24,
            lift: 0.017,
            camber: 0.016,
            sampleStep: 0.85,
            smoothPasses: a.id === 'qian-mid-north' ? 1 : 2,
            useHighTread: true
          });
          if (entry) ribbons.push(entry);
        }
        for (const sp of ql.spurs || []) {
          const entry = buildRibbonEntry(sp.points, {
            halfWidth: (sp.width || 1.04) * 0.5,
            vergeWidth: 0.20,
            lift: 0.015,
            camber: 0.012,
            sampleStep: 0.85,
            smoothPasses: 2,
            useHighTread: true
          });
          if (entry) ribbons.push(entry);
        }
        for (const ip of ql.interPlots || []) {
          const entry = buildRibbonEntry(ip.points, {
            halfWidth: (ip.width || 0.64) * 0.5,
            vergeWidth: 0.14,
            lift: 0.014,
            camber: 0.009,
            sampleStep: 0.90,
            smoothPasses: 1,
            useHighTread: true
          });
          if (entry) ribbons.push(entry);
        }
        for (const c of ql.culverts || []) {
          const yaw = Math.atan2(c.tx || 0, c.tz || 1);
          const cs = Math.cos(yaw), sn = Math.sin(yaw);
          const hw = 0.52, hd = 0.56;
          const rad = 0.85;
          const gy = field.sample(c.x, c.z);
          const cMat = c.kind === 'plank' ? 'wood' : 'stone';
          rotPads.push({
            x: c.x,
            z: c.z,
            c: cs,
            s: sn,
            hw,
            hd,
            bevel: 0.28,
            y: gy + (c.kind === 'plank' ? 0.108 : 0.092),
            material: cMat,
            rank: matRank(cMat),
            minX: c.x - rad,
            maxX: c.x + rad,
            minZ: c.z - rad,
            maxZ: c.z + rad
          });
        }
      });
    }

    if (exterior?.layout) {
      addOnce('exterior-paths-stops', () => {
        for (const p of exterior.layout.paths || []) {
          const pts = Array.isArray(p) ? p : p?.points;
          const entry = buildRibbonEntry(pts, {
            halfWidth: (p?.width || 1.25) * 0.5,
            vergeWidth: 0.22,
            lift: 0.075,
            camber: 0.008,
            sampleStep: 0.85,
            smoothPasses: 0,
            useHighTread: true
          });
          if (entry) ribbons.push(entry);
        }
        for (const st of exterior.layout.stops || []) {
          if (!Number.isFinite(st?.x) || !Number.isFinite(st?.z)) continue;
          const r = (st.radius || 1.1) * 0.95;
          const bevel = 0.28;
          const sy = baseTerrainY(field, st.x, st.z);
          discs.push({
            x: st.x,
            z: st.z,
            r,
            rSq: r * r,
            bevel,
            rOuterSq: (r + bevel) * (r + bevel),
            y: sy + 0.085,
            material: 'dirt',
            rank: 1
          });
        }
      });
    }

    if (leisureGrove?.layout) {
      addOnce('leisure-bridge-pavilion', () => {
        const br = leisureGrove.layout.bridge;
        if (br && Array.isArray(br.ends) && br.ends.length >= 2) {
          addBridge({
            x: br.x,
            z: br.z,
            tx: br.tx,
            tz: br.tz,
            ux: br.ux,
            uz: br.uz,
            halfL: (br.length || 4.0) * 0.5,
            halfW: (br.width || 1.4) * 0.5 + 0.06,
            bevelL: 0.38,
            bevelW: 0.20,
            endY0: br.ends[0].y + 0.055,
            endY1: br.ends[1].y + 0.055,
            arch: br.arch || 0,
            material: 'wood'
          });
        }
        const pav = leisureGrove.layout.pavilion || (leisureGrove.layout.regions || []).find(r => r && r.kind === 'pavilion');
        if (pav && Number.isFinite(pav.x) && Number.isFinite(pav.z)) {
          const py = Number.isFinite(pav.y) ? pav.y : baseTerrainY(field, pav.x, pav.z);
          const hw = 1.94;
          const bevel = 0.24;
          const rad = Math.hypot(hw + bevel, hw + bevel);
          rotPads.push({
            x: pav.x,
            z: pav.z,
            c: 1,
            s: 0,
            hw,
            hd: hw,
            bevel,
            y: py + 0.032,
            material: 'stone',
            rank: 2,
            minX: pav.x - rad,
            maxX: pav.x + rad,
            minZ: pav.z - rad,
            maxZ: pav.z + rad
          });
        }
      });
    }

    if (valleyBorderlands?.layout) {
      addOnce('borderlands-paths-landmarks', () => {
        for (const p of valleyBorderlands.layout.paths || []) {
          const pts = Array.isArray(p) ? p : p?.points;
          const entry = buildRibbonEntry(pts, {
            halfWidth: (p?.width || 1.6) * 0.5,
            vergeWidth: 0.25,
            lift: 0.052,
            camber: 0.018,
            sampleStep: 1.2,
            smoothPasses: 2,
            useHighTread: true,
            material: p?.kind === 'flagstone' ? 'stone' : 'dirt'
          });
          if (entry) ribbons.push(entry);
        }
        const sb = valleyBorderlands.layout.stoneBridge;
        if (sb && Number.isFinite(sb.x) && Number.isFinite(sb.z)) {
          const by = Number.isFinite(sb.y) ? sb.y : baseTerrainY(field, sb.x, sb.z);
          const yaw = sb.yaw || 0;
          const cs = Math.cos(yaw), sn = Math.sin(yaw);
          addBridge({
            x: sb.x,
            z: sb.z,
            tx: cs,
            tz: -sn,
            ux: sn,
            uz: cs,
            halfL: (sb.length || 5.2) * 0.5,
            halfW: (sb.width || 1.9) * 0.5 + 0.05,
            bevelL: 0.48,
            bevelW: 0.22,
            endY0: by + 0.155,
            endY1: by + 0.155,
            arch: 0.16,
            material: 'stone'
          });
        }
        const cp = valleyBorderlands.layout.cloudPavilion;
        if (cp && Number.isFinite(cp.x) && Number.isFinite(cp.z)) {
          const floorY = Number.isFinite(cp.y) ? cp.y : baseTerrainY(field, cp.x, cp.z) + 0.10;
          const pavR = 2.74;
          const bevel = 0.35;
          discs.push({
            x: cp.x,
            z: cp.z,
            r: pavR,
            rSq: pavR * pavR,
            bevel,
            rOuterSq: (pavR + bevel) * (pavR + bevel),
            y: floorY + 0.04,
            material: 'stone',
            rank: 2
          });
          // 西向四级石阶踏道平滑衔接至观云亭须弥座台基
          const botX = cp.x - 4.40;
          addBridge({
            x: cp.x - 3.55,
            z: cp.z,
            tx: 1,
            tz: 0,
            ux: 0,
            uz: 1,
            halfL: 0.85,
            halfW: 0.76,
            bevelL: 0.30,
            bevelW: 0.18,
            endY0: baseTerrainY(field, botX, cp.z) + 0.03,
            endY1: floorY + 0.04,
            arch: 0,
            material: 'stone'
          });
        }
      });
    }

    for (const [mod, key] of [
      [outerWilds, 'outerwilds-trails-decks'],
      [deepHollows, 'deephollows-trails-decks'],
      [wulingOutskirts, 'wuling-trails-decks']
    ]) {
      if (!mod?.layout) continue;
      addOnce(key, () => {
        for (const tr of mod.layout.trails || []) {
          const pts = Array.isArray(tr) ? tr : tr?.points;
          const entry = buildRibbonEntry(pts, {
            halfWidth: (tr?.width || 1.5) * 0.5,
            vergeWidth: 0.24,
            lift: 0.050,
            camber: 0.016,
            sampleStep: 1.2,
            smoothPasses: 2,
            useHighTread: true,
            material: tr?.kind === 'flagstone' ? 'stone' : 'dirt'
          });
          if (entry) ribbons.push(entry);
        }
        for (const dk of mod.layout.woodDecks || []) {
          if (!Number.isFinite(dk?.endY0) || !Number.isFinite(dk?.endY1)) continue;
          addBridge({
            x: dk.x,
            z: dk.z,
            tx: dk.tx,
            tz: dk.tz,
            ux: dk.ux,
            uz: dk.uz,
            halfL: (dk.length || 3.2) * 0.5,
            halfW: (dk.width || 1.5) * 0.5,
            bevelL: dk.bevelL ?? 0.45,
            bevelW: dk.bevelW ?? 0.22,
            endY0: dk.endY0,
            endY1: dk.endY1,
            arch: dk.arch || 0,
            material: dk.material || 'wood'
          });
        }
        for (const pf of mod.layout.walkPlatforms || []) {
          if (!Number.isFinite(pf?.x) || !Number.isFinite(pf?.z) || !Number.isFinite(pf?.y)) continue;
          const r = pf.r || 2.5;
          const bevel = pf.bevel ?? 0.5;
          const pMat = pf.material || 'stone';
          discs.push({
            x: pf.x,
            z: pf.z,
            r,
            rSq: r * r,
            bevel,
            rOuterSq: (r + bevel) * (r + bevel),
            y: pf.y,
            material: pMat,
            rank: matRank(pMat)
          });
        }
      });
    }
  }

  function walkSurface(x, z) {
    const baseY = baseTerrainY(field, x, z);
    let bestY = baseY;

    for (let i = 0; i < ribbons.length; i++) {
      const ry = evalRibbonHeight(ribbons[i], field, x, z, baseY);
      if (ry > bestY) bestY = ry;
    }

    for (let i = 0; i < bridges.length; i++) {
      const by = evalBridgeHeight(bridges[i], x, z, baseY);
      if (by > bestY) bestY = by;
    }

    for (let i = 0; i < rotPads.length; i++) {
      const p = rotPads[i];
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      const dx = x - p.x, dz = z - p.z;
      const lx = Math.abs(dx * p.c - dz * p.s);
      const lz = Math.abs(dx * p.s + dz * p.c);
      if (lx > p.hw + p.bevel || lz > p.hd + p.bevel) continue;
      if (lx <= p.hw && lz <= p.hd) {
        if (p.y > bestY) bestY = p.y;
      } else {
        const ox = Math.max(0, lx - p.hw) / p.bevel;
        const oz = Math.max(0, lz - p.hd) / p.bevel;
        const u = Math.min(1, Math.hypot(ox, oz));
        const s = u * u * (3 - 2 * u);
        const py = p.y * (1 - s) + baseY * s;
        if (py > bestY) bestY = py;
      }
    }

    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      const dx = x - d.x, dz = z - d.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > d.rOuterSq) continue;
      const dist = Math.sqrt(d2);
      if (dist <= d.r) {
        if (d.y > bestY) bestY = d.y;
      } else {
        const u = (dist - d.r) / d.bevel;
        const s = u * u * (3 - 2 * u);
        const py = d.y * (1 - s) + baseY * s;
        if (py > bestY) bestY = py;
      }
    }

    for (let i = 0; i < aabbPads.length; i++) {
      const b = aabbPads[i];
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const py = b.relativeOffset > 0 ? baseY + b.relativeOffset : b.y;
      if (py > bestY) bestY = py;
    }

    return bestY;
  }

  function surfaceMaterial(x, z) {
    let bestRank = 0;
    let bestMat = 'grass';

    for (let i = 0; i < bridges.length; i++) {
      const b = bridges[i];
      if (b.rank <= bestRank) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const absAlong = Math.abs(dx * b.tx + dz * b.tz);
      const across = Math.abs(dx * b.ux + dz * b.uz);
      if (absAlong <= b.halfL + 0.08 && across <= b.halfW + 0.08) {
        bestRank = b.rank;
        bestMat = b.material;
        if (bestRank >= 3) return bestMat;
      }
    }

    for (let i = 0; i < rotPads.length; i++) {
      const p = rotPads[i];
      if (p.rank <= bestRank) continue;
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      const lx = Math.abs(dx * p.c - dz * p.s);
      const lz = Math.abs(dx * p.s + dz * p.c);
      if (lx <= p.hw + 0.06 && lz <= p.hd + 0.06) {
        bestRank = p.rank;
        bestMat = p.material;
        if (bestRank >= 3) return bestMat;
      }
    }

    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      if (d.rank <= bestRank) continue;
      const dx = x - d.x;
      const dz = z - d.z;
      if (dx * dx + dz * dz <= d.rSq) {
        bestRank = d.rank;
        bestMat = d.material;
        if (bestRank >= 3) return bestMat;
      }
    }

    for (let i = 0; i < ribbons.length; i++) {
      const r = ribbons[i];
      if (r.rank <= bestRank) continue;
      if (evalRibbonHit(r, x, z)) {
        bestRank = r.rank;
        bestMat = r.material;
        if (bestRank >= 3) return bestMat;
      }
    }

    if (bestRank < 1) {
      for (let i = 0; i < aabbPads.length; i++) {
        const b = aabbPads[i];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
          return 'dirt';
        }
      }
    }

    return bestMat;
  }

  register(initial);
  if (field) {
    field.walkSurface = walkSurface;
    field.surfaceMaterial = surfaceMaterial;
  }
  return { register, walkSurface, surfaceMaterial };
}
