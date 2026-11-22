import * as THREE from 'three';
import { chaikinSmooth, resamplePolyline } from './road-geometry.js';
import { sampleGroundSurface } from './ground-surface.js';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lcg(seed) {
  let s = (seed >>> 0) || 20261119;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}

function createRoadSink() {
  const pos = [];
  const nor = [];
  const col = [];
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  const cC = new THREE.Color();

  function tri(a, b, c, hexA, hexB = hexA, hexC = hexA, forceUp = false) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const lenSq = nx * nx + ny * ny + nz * nz;
    if (lenSq < 1e-10 || !Number.isFinite(lenSq)) return;
    let v1 = b, v2 = c, h1 = hexB, h2 = hexC;
    if (forceUp && ny < 0) {
      nx = -nx; ny = -ny; nz = -nz;
      v1 = c; v2 = b; h1 = hexC; h2 = hexB;
    }
    const inv = 1 / Math.sqrt(lenSq);
    nx *= inv; ny *= inv; nz *= inv;
    cA.set(hexA);
    cB.set(h1);
    cC.set(h2);
    pos.push(a[0], a[1], a[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
    nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    col.push(cA.r, cA.g, cA.b, cB.r, cB.g, cB.b, cC.r, cC.g, cC.b);
  }

  function quad(a, b, c, d, hexA, hexB = hexA, hexC = hexB, hexD = hexA, forceUp = false) {
    tri(a, b, c, hexA, hexB, hexC, forceUp);
    tri(a, c, d, hexA, hexC, hexD, forceUp);
  }

  // 低多边形隆起软丘/雪堆/落英堆/苔垫（四周贴地微埋，顶面柔和起伏）
  function mound(cx, cy, cz, rx, rz, h, yaw, baseHex, topHex, segs = 6) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const top = [cx, cy + h, cz];
    const rim = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const w = 0.86 + 0.24 * Math.sin(a * 2.0 + cx * 0.7 + cz * 0.5);
      const lx = Math.cos(a) * rx * w;
      const lz = Math.sin(a) * rz * w;
      rim.push([
        cx + lx * cs - lz * sn,
        cy - 0.012,
        cz + lx * sn + lz * cs
      ]);
    }
    for (let i = 0; i < segs; i++) {
      const n = (i + 1) % segs;
      tri(rim[i], rim[n], top, baseHex, baseHex, topHex, true);
    }
  }

  // 带微斜倒角的立体扁平石板/冰片（顶面平坦、四边斜切贴入路面，无 Z-fighting）
  function chamferSlab(cx, cy, cz, hw, hd, thick, yaw, topHex, sideHex, bevel = 0.045) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const pt = (lx, ly, lz) => [
      cx + lx * cs - lz * sn,
      cy + ly,
      cz + lx * sn + lz * cs
    ];
    const iw = Math.max(0.02, hw - bevel);
    const id = Math.max(0.02, hd - bevel);
    const b0 = pt(-hw, -0.014, -hd), b1 = pt(hw, -0.014, -hd), b2 = pt(hw, -0.014, hd), b3 = pt(-hw, -0.014, hd);
    const t0 = pt(-iw, thick, -id), t1 = pt(iw, thick, -id), t2 = pt(iw, thick, id), t3 = pt(-iw, thick, id);
    quad(t0, t3, t2, t1, topHex, topHex, topHex, topHex, true);
    quad(b0, b1, t1, t0, sideHex, sideHex, topHex, topHex, false);
    quad(b1, b2, t2, t1, sideHex, sideHex, topHex, topHex, false);
    quad(b2, b3, t3, t2, sideHex, sideHex, topHex, topHex, false);
    quad(b3, b0, t0, t3, sideHex, sideHex, topHex, topHex, false);
  }

  // 轻盈折片花瓣 / 卷曲秋叶 / 碎草叶
  function curledLeaf(cx, cy, cz, len, wid, curl, yaw, hexA, hexB = hexA) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const pt = (lx, ly, lz) => [
      cx + lx * cs - lz * sn,
      cy + ly,
      cz + lx * sn + lz * cs
    ];
    const base = pt(-len * 0.5, 0.008, 0);
    const tip = pt(len * 0.5, 0.014 + curl, 0);
    const midL = pt(0, 0.012 + curl * 0.45, -wid * 0.5);
    const midR = pt(0, 0.012 + curl * 0.45, wid * 0.5);
    tri(base, midL, tip, hexA, hexB, hexB, true);
    tri(base, tip, midR, hexA, hexB, hexA, true);
  }

  // 弧形舒展宽叶 / 路沿蕨草 / 秋穗草茎
  function archBlade(ox, oy, oz, ang, len, wid, lift, hexBase, hexTip) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const sx = -dz * wid, sz = dx * wid;
    const p0 = [ox, oy - 0.01, oz];
    const mid = [ox + dx * len * 0.52, oy + lift * 0.72, oz + dz * len * 0.52];
    const tip = [ox + dx * len, oy + lift * 0.44, oz + dz * len];
    const pL = [mid[0] + sx, mid[1] - wid * 0.14, mid[2] + sz];
    const pR = [mid[0] - sx, mid[1] - wid * 0.14, mid[2] - sz];
    tri(p0, pL, tip, hexBase, hexTip, hexTip, true);
    tri(p0, tip, pR, hexBase, hexTip, hexBase, true);
  }

  // 微翘小花朵（4 瓣低多边形花冠）
  function floret(cx, cy, cz, r, cupH, hexPetal, hexCore) {
    const c = [cx, cy, cz];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + cx * 0.9 + cz * 0.7;
      const pL = [cx + Math.cos(a - 0.42) * r, cy + cupH, cz + Math.sin(a - 0.42) * r];
      const pR = [cx + Math.cos(a + 0.42) * r, cy + cupH, cz + Math.sin(a + 0.42) * r];
      tri(c, pR, pL, hexCore || hexPetal, hexPetal, hexPetal, true);
    }
  }

  // 立体连续雪埂 / 夯土车辙隆脊（沿道路方向铺展的三角断面长带）
  function ridgeStrip(slices, hexLow, hexMid, hexHigh) {
    if (slices.length < 2) return;
    for (let i = 0; i < slices.length - 1; i++) {
      const s0 = slices[i];
      const s1 = slices[i + 1];
      // 内斜坡 (inner -> crest) 与外斜坡 (crest -> outer)
      quad(s0.inPt, s0.crest, s1.crest, s1.inPt, hexMid, hexHigh, hexHigh, hexMid, true);
      quad(s0.crest, s0.outPt, s1.outPt, s1.crest, hexHigh, hexLow, hexLow, hexHigh, true);
    }
    // 首尾自然收口压入地面
    const f = slices[0];
    const l = slices[slices.length - 1];
    const fMid = [(f.inPt[0] + f.outPt[0]) * 0.5, Math.min(f.inPt[1], f.outPt[1]) - 0.015, (f.inPt[2] + f.outPt[2]) * 0.5];
    const lMid = [(l.inPt[0] + l.outPt[0]) * 0.5, Math.min(l.inPt[1], l.outPt[1]) - 0.015, (l.inPt[2] + l.outPt[2]) * 0.5];
    tri(f.inPt, fMid, f.crest, hexMid, hexLow, hexHigh, true);
    tri(fMid, f.outPt, f.crest, hexLow, hexLow, hexHigh, true);
    tri(l.crest, lMid, l.inPt, hexHigh, hexLow, hexMid, true);
    tri(l.crest, l.outPt, lMid, hexHigh, hexLow, hexLow, true);
  }

  // 散落稻草秸秆 / 冬日寒枝
  function strawTwig(x0, y0, z0, x1, y1, z1, wid, hexA, hexB = hexA) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * wid;
    const nz = (dx / len) * wid;
    quad(
      [x0 - nx, y0, z0 - nz],
      [x0 + nx, y0, z0 + nz],
      [x1 + nx * 0.7, y1, z1 + nz * 0.7],
      [x1 - nx * 0.7, y1, z1 - nz * 0.7],
      hexA, hexA, hexB, hexB, true
    );
  }

  function finish(name, visible) {
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -4
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.visible = Boolean(visible);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    return mesh;
  }

  return {
    tri,
    quad,
    mound,
    chamferSlab,
    curledLeaf,
    archBlade,
    floret,
    ridgeStrip,
    strawTwig,
    finish,
    get triCount() { return pos.length / 9; }
  };
}

function sampleRoadPolylines(rawPoints, sampleStep, smoothPasses = 2) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) return [];
  const norm = rawPoints
    .map(p => (Array.isArray(p) ? [p[0], p[1]] : [p?.x, p?.z]))
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (norm.length < 2) return [];
  const smoothed = smoothPasses > 0 ? chaikinSmooth(norm, smoothPasses) : norm;
  const pts = resamplePolyline(smoothed, sampleStep);
  if (pts.length < 2) return [];
  return pts.map((p, k) => {
    const prev = pts[Math.max(0, k - 1)];
    const next = pts[Math.min(pts.length - 1, k + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    return {
      x: p.x,
      z: p.z,
      dist: p.dist,
      u: p.u,
      total: p.total,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      yaw: Math.atan2(tx, tz)
    };
  });
}

function collectRoadSpecs({ world, village, hinterland, qianmoPaths, exterior, valleyBorderlands, outerWilds }) {
  const interior = [];
  const ext = [];

  if (world?.village?.road?.points?.length >= 2) {
    interior.push({
      id: 'village-main',
      kind: 'main',
      halfWidth: (world.village.road.width || 3.6) * 0.5,
      sampleStep: 1.55,
      smoothPasses: 2,
      points: world.village.road.points
    });
  }

  const houses = village?.houseInfo || [];
  const nMain = world?.village?.houses?.count || 8;
  for (let i = 0; i < houses.length; i++) {
    const sp = houses[i]?.spur;
    if (!sp?.pts || sp.pts.length < 2) continue;
    const isBack = i >= nMain || Boolean(sp.back);
    interior.push({
      id: `village-spur-${i}`,
      kind: isBack ? 'lane' : 'spur',
      halfWidth: sp.half || (isBack ? 1.55 : 0.62),
      sampleStep: isBack ? 2.1 : 2.4,
      smoothPasses: 2,
      points: sp.pts
    });
  }

  if (qianmoPaths?.layout?.enabled) {
    for (const a of qianmoPaths.layout.arteries || []) {
      if (a?.points?.length >= 2) {
        interior.push({
          id: a.id || 'qianmo-artery',
          kind: 'qianmo',
          halfWidth: (a.width || 1.4) * 0.5,
          sampleStep: 2.15,
          smoothPasses: a.id === 'qian-mid-north' ? 1 : 2,
          points: a.points
        });
      }
    }
    for (const sp of (qianmoPaths.layout.spurs || []).slice(0, 6)) {
      if (sp?.points?.length >= 2) {
        interior.push({
          id: sp.id || 'qianmo-spur',
          kind: 'spur',
          halfWidth: (sp.width || 1.04) * 0.5,
          sampleStep: 2.5,
          smoothPasses: 2,
          points: sp.points
        });
      }
    }
  }

  for (const p of hinterland?.paths || world?.hinterland?.paths || []) {
    if (p?.points?.length >= 2) {
      interior.push({
        id: p.id || 'hinterland-path',
        kind: 'trail',
        halfWidth: (p.width || 1.5) * 0.5,
        sampleStep: 2.8,
        smoothPasses: 2,
        points: p.points
      });
    }
  }

  for (const p of valleyBorderlands?.layout?.paths || []) {
    if (p?.points?.length >= 2) {
      interior.push({
        id: p.id || 'borderland-path',
        kind: p.kind === 'flagstone' ? 'stone-trail' : 'trail',
        halfWidth: (p.width || 1.6) * 0.5,
        sampleStep: 3.1,
        smoothPasses: 2,
        points: p.points
      });
    }
  }

  for (const p of exterior?.layout?.paths || []) {
    const pts = Array.isArray(p) ? p : p?.points;
    if (pts?.length >= 2) {
      ext.push({
        id: p?.id || 'exterior-path',
        kind: 'exterior-path',
        halfWidth: (p?.width || 1.25) * 0.5,
        sampleStep: 1.75,
        smoothPasses: 1,
        points: pts
      });
    }
  }

  for (const tr of (outerWilds?.layout?.trails || []).slice(0, 5)) {
    const pts = Array.isArray(tr) ? tr : tr?.points;
    if (pts?.length >= 2) {
      ext.push({
        id: tr?.id || 'outer-trail',
        kind: tr?.kind === 'flagstone' ? 'stone-trail' : 'exterior-path',
        halfWidth: (tr?.width || 1.5) * 0.5,
        sampleStep: 2.3,
        smoothPasses: 2,
        points: pts
      });
    }
  }

  return { interior, exterior: ext };
}

function makeRoadGuard({ world, field, village, cliff }) {
  const waterLevel = Number(world?.terrain?.waterLevel ?? -1.0);
  const pond = world?.terrain?.pond || null;
  const houses = village?.houseInfo || [];
  const slit = cliff?.slit || null;
  const slitUx = slit ? Math.cos(slit.angle || 0) : 1;
  const slitUz = slit ? Math.sin(slit.angle || 0) : 0;
  const slitTx = -slitUz;
  const slitTz = slitUx;

  function surfaceY(x, z) {
    const y = sampleGroundSurface(field, x, z);
    return Number.isFinite(y) ? y : 0;
  }

  function isDrySafe(x, z, keepHouseMargin = 0.55) {
    const y = surfaceY(x, z);
    if (!Number.isFinite(y) || y < waterLevel + 0.16) return false;
    if (pond && Number.isFinite(pond.x) && Number.isFinite(pond.z)) {
      const pr = (pond.waterRadius || (pond.radius || 13) * 0.74) + 0.65;
      if (Math.hypot(x - pond.x, z - pond.z) < pr) return false;
    }
    if (slit && Number.isFinite(slit.x) && Number.isFinite(slit.z)) {
      const dx = x - slit.x;
      const dz = z - slit.z;
      const along = dx * slitUx + dz * slitUz;
      const lat = Math.abs(dx * slitTx + dz * slitTz);
      if (along > -24 && along < 17 && lat < 4.2) return false;
    }
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const dx = x - h.x;
      const dz = z - h.z;
      const reach = (h.w || 6) * 0.5 + (h.d || 5) * 0.5 + keepHouseMargin;
      if (dx * dx + dz * dz > reach * reach) continue;
      const c = Math.cos(h.rot || 0);
      const s = Math.sin(h.rot || 0);
      const lx = Math.abs(dx * c - dz * s);
      const lz = Math.abs(dx * s + dz * c);
      if (lx < (h.w || 6) * 0.5 + keepHouseMargin && lz < (h.d || 5) * 0.5 + keepHouseMargin) return false;
    }
    return true;
  }

  return { surfaceY, isDrySafe };
}

function populateZoneRoads(roadSpecs, guard, rng, sinks) {
  const { spring, summer, autumn, winter } = sinks;
  const { surfaceY, isDrySafe } = guard;

  const SPRING_PETALS = ['#F5C8D3', '#EBA2B5', '#FCEEF1', '#E397AB'];
  const SPRING_FLOWERS = ['#F3EFE0', '#D49CC9', '#ECD056'];
  const SUMMER_STONES = ['#849188', '#95A298', '#758279', '#8B988E'];
  const SUMMER_MOSS = ['#3D7A41', '#4E8F4B', '#336C38'];
  const AUTUMN_LEAVES = ['#EBB63E', '#DF7132', '#BE452C', '#C98A36', '#E5A038'];
  const AUTUMN_STRAW = ['#DEC062', '#C99F44', '#E5CC76'];

  for (const spec of roadSpecs) {
    const stations = sampleRoadPolylines(spec.points, spec.sampleStep, spec.smoothPasses);
    if (stations.length < 3) continue;
    const isMain = spec.kind === 'main';
    const isLane = spec.kind === 'lane';
    const isQianmo = spec.kind === 'qianmo';
    const isExt = spec.kind === 'exterior-path';
    const hw = spec.halfWidth;

    // 连续雪埂与秋车辙隆脊采样点缓冲
    const snowBankL = [];
    const snowBankR = [];
    const snowCenter = [];
    const autumnRidge = [];

    const flushWinterSegment = (arr, lowHex, midHex, highHex) => {
      if (arr.length >= 2) winter.ridgeStrip(arr, lowHex, midHex, highHex);
      arr.length = 0;
    };
    const flushAutumnSegment = (arr) => {
      if (arr.length >= 2) autumn.ridgeStrip(arr, '#9A784C', '#AF8959', '#C09B6A');
      arr.length = 0;
    };

    for (let k = 0; k < stations.length; k++) {
      const st = stations[k];
      const endFade = Math.min(1, Math.min(st.dist, st.total - st.dist) / 2.2);
      const safeCenter = isDrySafe(st.x, st.z, 0.35);

      // ======================================================================
      // 1) 春深 · 路缘落英花瓣带 + 嫩苔软垫 + 路畔春花
      // ======================================================================
      if (safeCenter && (isMain || isLane || isQianmo || isExt || k % 2 === 0)) {
        for (const side of [-1, 1]) {
          const n = smoothNoise2(st.x * 0.28 + side * 4.1, st.z * 0.28 - 2.3);
          const off = hw * (0.76 + n * 0.28);
          const px = st.x + st.nx * side * off;
          const pz = st.z + st.nz * side * off;
          if (!isDrySafe(px, pz, 0.42)) continue;
          const py = surfaceY(px, pz);

          // 路缘积聚桃花瓣软带（外溪与主村道最繁密，阡陌稍清雅）
          const petalChance = isExt ? 0.85 : isMain ? 0.72 : isLane ? 0.56 : 0.42;
          if (rng() < petalChance) {
            const pHexA = SPRING_PETALS[Math.floor(rng() * SPRING_PETALS.length)];
            const pHexB = SPRING_PETALS[Math.floor(rng() * SPRING_PETALS.length)];
            spring.mound(
              px, py + 0.012, pz,
              0.24 + rng() * 0.22,
              0.42 + rng() * 0.36,
              0.022 + rng() * 0.018,
              st.yaw + (rng() - 0.5) * 0.35,
              pHexA, pHexB, 5
            );
            // 2~3 枚风吹卷翘落瓣点缀在花带与路肩间
            const driftCount = isMain || isExt ? 3 : 2;
            for (let d = 0; d < driftCount; d++) {
              const lx = px - st.nx * side * (0.12 + rng() * hw * 0.48) + st.tx * (rng() - 0.5) * 0.85;
              const lz = pz - st.nz * side * (0.12 + rng() * hw * 0.48) + st.tz * (rng() - 0.5) * 0.85;
              const ly = surfaceY(lx, lz);
              spring.curledLeaf(
                lx, ly + 0.010, lz,
                0.11 + rng() * 0.06,
                0.08 + rng() * 0.04,
                0.014,
                rng() * TAU,
                SPRING_PETALS[d % SPRING_PETALS.length],
                '#FCEEF2'
              );
            }
          }

          // 路牙外侧嫩绿苔垫与春野碎花
          if (k % (isMain ? 2 : 3) === (side > 0 ? 0 : 1) && rng() < 0.70) {
            const mx = st.x + st.nx * side * (hw + 0.14 + rng() * 0.18);
            const mz = st.z + st.nz * side * (hw + 0.14 + rng() * 0.18);
            if (isDrySafe(mx, mz, 0.48)) {
              const my = surfaceY(mx, mz);
              spring.mound(mx, my + 0.008, mz, 0.20 + rng() * 0.14, 0.30 + rng() * 0.22, 0.032 + rng() * 0.02, st.yaw, '#6B9C46', '#89BA57', 5);
              if (rng() < 0.62) {
                const fCol = SPRING_FLOWERS[Math.floor(rng() * SPRING_FLOWERS.length)];
                spring.floret(mx + (rng() - 0.5) * 0.14, my + 0.065, mz + (rng() - 0.5) * 0.14, 0.062, 0.022, fCol, '#E4BE4E');
              }
            }
          }
        }
      }

      // ======================================================================
      // 2) 夏初 · 嵌苔青石板路芯 + 绿荫漫沿宽叶蕨草 + 夏雨浅洼
      // ======================================================================
      if (safeCenter) {
        // 主村道与后排巷道铺设错缝青石板 + 绿苔石缝（显著改变夏日马路建模质感）
        if ((isMain && k % 2 === 0 && k > 1 && k < stations.length - 2) || (isLane && k % 3 === 1)) {
          const rowCount = isMain ? 2 : 1;
          for (let r = 0; r < rowCount; r++) {
            const lat = rowCount === 2 ? (r === 0 ? -hw * 0.34 : hw * 0.34) + (k % 4 === 0 ? 0.14 : -0.14) : ((k % 2 === 0 ? 1 : -1) * 0.16);
            const sx = st.x + st.nx * lat + st.tx * (r === 0 ? -0.12 : 0.14);
            const sz = st.z + st.nz * lat + st.tz * (r === 0 ? -0.12 : 0.14);
            if (!isDrySafe(sx, sz, 0.35)) continue;
            const sy = surfaceY(sx, sz);
            const sW = isMain ? (0.44 + rng() * 0.14) : (0.34 + rng() * 0.10);
            const sD = isMain ? (0.58 + rng() * 0.18) : (0.42 + rng() * 0.14);
            const sCol = SUMMER_STONES[(k + r) % SUMMER_STONES.length];
            summer.chamferSlab(sx, sy + 0.004, sz, sW, sD, 0.028, st.yaw + (rng() - 0.5) * 0.07, sCol, '#5D6C62', 0.055);
            // 石缝两侧萌发翠绿湿苔条
            const mSide = (k + r) % 2 === 0 ? 1 : -1;
            const mx = sx + st.nx * mSide * (sW + 0.05);
            const mz = sz + st.nz * mSide * (sW + 0.05);
            summer.mound(mx, surfaceY(mx, mz) + 0.008, mz, 0.12, sD * 0.65, 0.024, st.yaw, SUMMER_MOSS[0], SUMMER_MOSS[1], 5);
          }
        } else if (isQianmo && k % 4 === 2 && rng() < 0.72) {
          // 阡陌干道中嵌青苔踏步石
          const sy = surfaceY(st.x, st.z);
          summer.chamferSlab(st.x, sy + 0.004, st.z, 0.28 + rng() * 0.08, 0.34 + rng() * 0.10, 0.024, st.yaw + (rng() - 0.5) * 0.12, SUMMER_STONES[k % SUMMER_STONES.length], '#58695B', 0.045);
        }

        // 偶见夏雨初霁清浅积水洼（隐映青天色 + 深湿土缘）
        if ((isMain || isQianmo || isExt) && k % 7 === 3 && rng() < 0.68) {
          const pSide = k % 2 === 0 ? 1 : -1;
          const px = st.x + st.nx * pSide * (hw * 0.48);
          const pz = st.z + st.nz * pSide * (hw * 0.48);
          if (isDrySafe(px, pz, 0.4)) {
            const py = surfaceY(px, pz);
            summer.mound(px, py + 0.008, pz, 0.36 + rng() * 0.14, 0.62 + rng() * 0.26, 0.011, st.yaw + 0.08, '#6D5D46', '#675742', 6);
            summer.chamferSlab(px, py + 0.011, pz, 0.25 + rng() * 0.10, 0.46 + rng() * 0.18, 0.010, st.yaw + 0.08, '#7CA5A6', '#698F91', 0.06);
          }
        }

        // 路缘茂盛漫沿的夏草、宽叶车前草与橙黄萱草（让夏日道路显得绿意合拢）
        for (const side of [-1, 1]) {
          if (!isMain && !isLane && !isExt && k % 2 === 1) continue;
          const gx = st.x + st.nx * side * (hw + 0.04 + rng() * 0.18);
          const gz = st.z + st.nz * side * (hw + 0.04 + rng() * 0.18);
          if (!isDrySafe(gx, gz, 0.48)) continue;
          const gy = surfaceY(gx, gz);
          const blades = isMain || isExt ? 3 : 2;
          for (let b = 0; b < blades; b++) {
            // 叶片朝路面微倾探入，呈现盛夏草木漫过路肩之态
            const inwardAng = Math.atan2(-st.nz * side, -st.nx * side) + (b - 1) * 0.68 + (rng() - 0.5) * 0.3;
            summer.archBlade(
              gx + (rng() - 0.5) * 0.14, gy + 0.008, gz + (rng() - 0.5) * 0.14,
              inwardAng,
              0.24 + rng() * 0.16,
              0.055 + rng() * 0.025,
              0.12 + rng() * 0.08,
              SUMMER_MOSS[0],
              b % 2 === 0 ? SUMMER_MOSS[1] : '#5CA052'
            );
          }
          if ((isMain || isQianmo || isExt) && k % 5 === (side > 0 ? 1 : 3) && rng() < 0.65) {
            summer.floret(gx, gy + 0.17, gz, 0.085, 0.036, '#EC8C34', '#A85020');
          }
        }
      }

      // ======================================================================
      // 3) 秋熟 · 车辙隆脊 + 满路丹枫银杏落叶毯 + 散落稻穗枯草
      // ======================================================================
      if (safeCenter && (isMain || isQianmo) && endFade > 0.25) {
        const yC = surfaceY(st.x, st.z);
        const ridgeW = isMain ? 0.34 : 0.20;
        const ridgeH = (isMain ? 0.036 : 0.022) * endFade * (0.82 + 0.34 * smoothNoise2(st.x * 0.35, st.z * 0.35));
        autumnRidge.push({
          inPt: [st.x - st.nx * ridgeW, yC + 0.006, st.z - st.nz * ridgeW],
          crest: [st.x, yC + 0.008 + ridgeH, st.z],
          outPt: [st.x + st.nx * ridgeW, yC + 0.006, st.z + st.nz * ridgeW]
        });
      } else {
        flushAutumnSegment(autumnRidge);
      }

      if (safeCenter) {
        for (const side of [-1, 1]) {
          const n = smoothNoise2(st.x * 0.25 - side * 2.7, st.z * 0.25 + 5.1);
          const off = hw * (0.72 + n * 0.34);
          const ax = st.x + st.nx * side * off;
          const az = st.z + st.nz * side * off;
          if (!isDrySafe(ax, az, 0.42)) continue;
          const ay = surfaceY(ax, az);

          // 路缘厚积秋叶堆（银杏金 / 丹枫红 / 柿橙）
          const leafPileChance = isMain || isExt ? 0.80 : isLane || isQianmo ? 0.58 : 0.42;
          if (rng() < leafPileChance) {
            const cLo = AUTUMN_LEAVES[Math.floor(rng() * AUTUMN_LEAVES.length)];
            const cHi = AUTUMN_LEAVES[Math.floor(rng() * AUTUMN_LEAVES.length)];
            autumn.mound(
              ax, ay + 0.012, az,
              0.28 + rng() * 0.24,
              0.50 + rng() * 0.44,
              0.032 + rng() * 0.026,
              st.yaw + (rng() - 0.5) * 0.4,
              cLo, cHi, 5
            );
            // 路心斜扫卷曲落叶
            const scatterN = isMain || isExt ? 2 : 1;
            for (let d = 0; d < scatterN; d++) {
              const frac = (rng() - 0.5) * 1.65;
              const lx = st.x + st.nx * frac * hw + st.tx * (rng() - 0.5) * 0.9;
              const lz = st.z + st.nz * frac * hw + st.tz * (rng() - 0.5) * 0.9;
              const ly = surfaceY(lx, lz);
              const lc = AUTUMN_LEAVES[(k + d) % AUTUMN_LEAVES.length];
              autumn.curledLeaf(lx, ly + 0.011, lz, 0.14 + rng() * 0.08, 0.095 + rng() * 0.05, 0.018, rng() * TAU, lc, '#F0C752');
            }
          }

          // 路沿枯黄秋草与野生金菊
          if (k % (isMain ? 3 : 4) === (side > 0 ? 0 : 2) && rng() < 0.72) {
            const gx = st.x + st.nx * side * (hw + 0.14 + rng() * 0.18);
            const gz = st.z + st.nz * side * (hw + 0.14 + rng() * 0.18);
            if (isDrySafe(gx, gz, 0.48)) {
              const gy = surfaceY(gx, gz);
              const ang = Math.atan2(-st.nz * side, -st.nx * side) + (rng() - 0.5) * 0.7;
              autumn.archBlade(gx, gy + 0.008, gz, ang, 0.26, 0.046, 0.14, '#9E8140', '#D8B454');
              autumn.archBlade(gx, gy + 0.008, gz, ang + 0.9, 0.22, 0.042, 0.12, '#8F7139', '#CCA448');
              if (rng() < 0.55) {
                autumn.floret(gx, gy + 0.16, gz, 0.078, 0.028, '#EEBE3A', '#B56E24');
              }
            }
          }
        }

        // 秋收运粮散落的金黄稻草秸秆（主村道与阡陌田道）
        if ((isMain || isQianmo) && k % 3 === 1 && rng() < 0.76) {
          for (let s = 0; s < 2; s++) {
            const rutSide = s === 0 ? -1 : 1;
            const sx = st.x + st.nx * rutSide * (hw * 0.52 + (rng() - 0.5) * 0.22);
            const sz = st.z + st.nz * rutSide * (hw * 0.52 + (rng() - 0.5) * 0.22);
            const sy = surfaceY(sx, sz) + 0.014;
            const ang = st.yaw + (rng() - 0.5) * 1.1;
            const halfLen = 0.16 + rng() * 0.14;
            const dx = Math.sin(ang) * halfLen;
            const dz = Math.cos(ang) * halfLen;
            autumn.strawTwig(sx - dx, sy, sz - dz, sx + dx, sy + 0.008, sz + dz, 0.022, AUTUMN_STRAW[s % 3], AUTUMN_STRAW[(s + 1) % 3]);
          }
        }
      }

      // ======================================================================
      // 4) 冬寂 · 路畔立体积雪埂 + 路芯雪脊 + 压辙冻冰 + 寒枝
      // ======================================================================
      if (safeCenter && endFade > 0.18) {
        // 两侧立体连绵积雪埂（显著改变冬日道路断面轮廓）
        const buildBankPoint = (side, arr) => {
          const n = smoothNoise2(st.x * 0.22 + side * 6.3, st.z * 0.22 - 3.9);
          const inOff = hw * (isMain ? 0.78 : 0.72) + (n - 0.5) * 0.14;
          const crestOff = hw + (isMain ? 0.24 : 0.16) + n * 0.12;
          const outOff = hw + (isMain ? 0.68 : 0.46) + n * 0.16;
          const ix = st.x + st.nx * side * inOff, iz = st.z + st.nz * side * inOff;
          const cx = st.x + st.nx * side * crestOff, cz = st.z + st.nz * side * crestOff;
          const ox = st.x + st.nx * side * outOff, oz = st.z + st.nz * side * outOff;
          if (!isDrySafe(cx, cz, 0.48)) {
            flushWinterSegment(arr, '#C9D5DC', '#DFE5E7', '#F2F2EC');
            return;
          }
          const hBase = isMain ? 0.16 : isLane || isExt ? 0.12 : 0.095;
          const h = hBase * endFade * (0.72 + 0.58 * n);
          arr.push({
            inPt: [ix, surfaceY(ix, iz) + 0.006, iz],
            crest: [cx, surfaceY(cx, cz) + h, cz],
            outPt: [ox, surfaceY(ox, oz) - 0.008, oz]
          });
        };
        buildBankPoint(-1, snowBankL);
        buildBankPoint(1, snowBankR);

        // 主村道与宽巷路芯（两道车辙之间）立体松雪脊
        if ((isMain || isLane) && endFade > 0.28) {
          const nC = smoothNoise2(st.x * 0.31 + 1.5, st.z * 0.31 - 2.1);
          const midW = isMain ? 0.38 : 0.24;
          const midH = (isMain ? 0.056 : 0.038) * endFade * (0.70 + 0.55 * nC);
          const yC = surfaceY(st.x, st.z);
          snowCenter.push({
            inPt: [st.x - st.nx * midW, yC + 0.006, st.z - st.nz * midW],
            crest: [st.x, yC + 0.008 + midH, st.z],
            outPt: [st.x + st.nx * midW, yC + 0.006, st.z + st.nz * midW]
          });
        } else {
          flushWinterSegment(snowCenter, '#D5DDE1', '#E6EAE8', '#F4F4EE');
        }

        // 车辙凹槽薄冻冰片（清冷青白釉面冰痕）
        if ((isMain || isQianmo || isExt) && k % 4 === 2 && rng() < 0.72) {
          const rSide = k % 8 === 2 ? -1 : 1;
          const ix = st.x + st.nx * rSide * (hw * 0.50);
          const iz = st.z + st.nz * rSide * (hw * 0.50);
          if (isDrySafe(ix, iz, 0.36)) {
            const iy = surfaceY(ix, iz);
            winter.chamferSlab(ix, iy + 0.006, iz, 0.16 + rng() * 0.08, 0.44 + rng() * 0.24, 0.012, st.yaw + (rng() - 0.5) * 0.08, '#D5E6EC', '#B6CED7', 0.05);
          }
        }

        // 雪埂旁偶尔露出的墨褐寒枝与覆雪路石
        if ((isMain || isQianmo || isExt) && k % 6 === 4 && rng() < 0.60) {
          const side = rng() < 0.5 ? -1 : 1;
          const tx = st.x + st.nx * side * (hw + 0.22);
          const tz = st.z + st.nz * side * (hw + 0.22);
          if (isDrySafe(tx, tz, 0.48)) {
            const ty = surfaceY(tx, tz) + 0.06;
            const ang = st.yaw + side * 0.7 + (rng() - 0.5) * 0.5;
            winter.strawTwig(tx, ty, tz, tx + Math.sin(ang) * 0.34, ty + 0.05, tz + Math.cos(ang) * 0.34, 0.014, '#5B5046', '#72665B');
          }
        }
      } else {
        flushWinterSegment(snowBankL, '#C9D5DC', '#DFE5E7', '#F2F2EC');
        flushWinterSegment(snowBankR, '#C9D5DC', '#DFE5E7', '#F2F2EC');
        flushWinterSegment(snowCenter, '#D5DDE1', '#E6EAE8', '#F4F4EE');
      }
    }

    flushWinterSegment(snowBankL, '#C9D5DC', '#DFE5E7', '#F2F2EC');
    flushWinterSegment(snowBankR, '#C9D5DC', '#DFE5E7', '#F2F2EC');
    flushWinterSegment(snowCenter, '#D5DDE1', '#E6EAE8', '#F4F4EE');
    flushAutumnSegment(autumnRidge);
  }
}

/**
 * 构建四季专属道路 3D 建模装饰层（春落英苔径 / 夏青石润苔 / 秋落叶车辙 / 冬雪埂冻冰），
 * 室内谷地与外溪各 4 个静态合批 Mesh，切换季节仅改 visible（每域仅 1 Draw Call）。
 */
export function buildSeasonalRoadDressing(options = {}) {
  const { field } = options;
  if (!field?.sample) {
    return {
      interiorMeshes: {},
      exteriorMeshes: {},
      setSeason() {},
      getStats: () => ({ season: 'spring', drawCalls: 0, triangles: 0, activeMesh: null }),
      dispose() {}
    };
  }

  const specs = collectRoadSpecs(options);
  const guard = makeRoadGuard(options);

  const intSinks = {
    spring: createRoadSink(),
    summer: createRoadSink(),
    autumn: createRoadSink(),
    winter: createRoadSink()
  };
  const extSinks = {
    spring: createRoadSink(),
    summer: createRoadSink(),
    autumn: createRoadSink(),
    winter: createRoadSink()
  };

  populateZoneRoads(specs.interior, guard, lcg(20261119), intSinks);
  populateZoneRoads(specs.exterior, guard, lcg(20261207), extSinks);

  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const interiorMeshes = {};
  const exteriorMeshes = {};
  for (const s of seasons) {
    interiorMeshes[s] = intSinks[s].finish(`seasonal-road-${s}`, s === 'spring');
    exteriorMeshes[s] = extSinks[s].finish(`seasonal-road-ext-${s}`, s === 'spring');
  }

  let currentSeason = 'spring';

  function setSeason(id) {
    const next = seasons.includes(id) ? id : 'spring';
    currentSeason = next;
    for (const s of seasons) {
      if (interiorMeshes[s]) interiorMeshes[s].visible = (s === next);
      if (exteriorMeshes[s]) exteriorMeshes[s].visible = (s === next);
    }
  }

  function getStats() {
    let drawCalls = 0;
    let triangles = 0;
    const im = interiorMeshes[currentSeason];
    const em = exteriorMeshes[currentSeason];
    if (im?.visible) {
      drawCalls += 1;
      triangles += im.geometry.attributes.position.count / 3;
    }
    if (em?.visible) {
      drawCalls += 1;
      triangles += em.geometry.attributes.position.count / 3;
    }
    return {
      season: currentSeason,
      activeMesh: im?.visible ? im.name : (em?.visible ? em.name : null),
      interiorRoadCount: specs.interior.length,
      exteriorRoadCount: specs.exterior.length,
      drawCalls,
      triangles: Math.round(triangles)
    };
  }

  function dispose() {
    for (const s of seasons) {
      for (const m of [interiorMeshes[s], exteriorMeshes[s]]) {
        if (!m) continue;
        m.geometry?.dispose?.();
        m.material?.dispose?.();
        m.removeFromParent?.();
      }
    }
  }

  return {
    interiorMeshes,
    exteriorMeshes,
    setSeason,
    getStats,
    dispose
  };
}

const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _cSnow = new THREE.Color('#E9E7DF');
const _cSummerGrass = new THREE.Color('#438446');
const _cSummerEarth = new THREE.Color('#CAB68B');
const _cSummerMossShade = new THREE.Color('#6F8156');
const _cAutumnGrass = new THREE.Color('#C8A34E');
const _cAutumnEarth = new THREE.Color('#B58958');
const _cAutumnLeafTint = new THREE.Color('#D47D36');
const _cWinterMud = new THREE.Color('#6F675E');

function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 统一四季道路顶点色转化：区分草缘、路芯、车辙与碎石，
 * 春深完全无损还原快照；夏初绿缘漫溢与晴土润苔；秋熟暖赭车辙与落叶微染；冬寂雪覆路肩而车辙透冻土。
 */
export function applySeasonalRoadVertexColors(snap, seasonId, opts = {}) {
  if (!snap?.geo || !snap?.colors) return;
  const dst = snap.geo.attributes.color.array;
  const src = snap.colors;
  if (seasonId === 'spring') {
    dst.set(src);
    snap.geo.attributes.color.needsUpdate = true;
    return;
  }
  const pos = snap.geo.attributes.position?.array;
  const nor = snap.geo.attributes.normal?.array;
  const strongTracks = Boolean(opts.strongTracks);

  for (let i = 0; i < src.length; i += 3) {
    const sr = src[i], sg = src[i + 1], sb = src[i + 2];
    const px = pos ? pos[i] : 0;
    const pz = pos ? pos[i + 2] : 0;
    const ny = nor ? Math.abs(nor[i + 1]) : 1;
    const gDom = clamp((sg - sr - 0.016) * 8.5, 0, 1);
    const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
    const detail = clamp(lum / 0.34, 0.74, 1.24);
    const nPatch = smoothNoise2(px * 0.19 + 2.3, pz * 0.19 - 4.7);
    const nFine = smoothNoise2(px * 0.52 - 7.1, pz * 0.52 + 3.4);
    // 车辙低暗带特征（buildNaturalRoadRibbon 将左右车辙调暗 -0.024，路芯调亮 +0.015）
    const isRutBand = gDom < 0.25 && sr > sb + 0.04 && lum < 0.44;

    if (seasonId === 'summer') {
      if (gDom > 0.02) {
        _cA.copy(_cSummerGrass);
        dst[i] = lerpNum(sr, clamp(_cA.r * detail, 0, 1), gDom * 0.90);
        dst[i + 1] = lerpNum(sg, clamp(_cA.g * detail, 0, 1), gDom * 0.90);
        dst[i + 2] = lerpNum(sb, clamp(_cA.b * detail, 0, 1), gDom * 0.90);
      } else {
        // 盛夏路面：中央晴晒略暖亮，两侧微带湿苔橄榄影
        const mossEdge = clamp((0.68 - nPatch) * 0.55 + (isRutBand ? 0.20 : 0), 0, 0.38);
        _cA.setRGB(sr, sg, sb).lerp(_cSummerEarth, 0.28 * nFine).lerp(_cSummerMossShade, mossEdge * 0.42);
        dst[i] = clamp(_cA.r, 0, 1);
        dst[i + 1] = clamp(_cA.g, 0, 1);
        dst[i + 2] = clamp(_cA.b, 0, 1);
      }
    } else if (seasonId === 'autumn') {
      if (gDom > 0.02) {
        _cA.copy(_cAutumnGrass);
        dst[i] = lerpNum(sr, clamp(_cA.r * detail, 0, 1), gDom * 0.90);
        dst[i + 1] = lerpNum(sg, clamp(_cA.g * detail, 0, 1), gDom * 0.90);
        dst[i + 2] = lerpNum(sb, clamp(_cA.b * detail, 0, 1), gDom * 0.90);
      } else {
        // 深秋路面：夯土转暖赭焦黄，车辙加深，风吹落叶暖橙斑驳晕染
        const leafMottle = smoothNoise2(px * 0.26 + 9.2, pz * 0.26 - 6.8);
        const rutDark = isRutBand ? (strongTracks ? 0.86 : 0.91) : 1.0;
        _cA.setRGB(sr, sg, sb).lerp(_cAutumnEarth, 0.46);
        if (leafMottle > 0.56) {
          _cA.lerp(_cAutumnLeafTint, (leafMottle - 0.56) * 0.92);
        }
        dst[i] = clamp(_cA.r * rutDark, 0, 1);
        dst[i + 1] = clamp(_cA.g * rutDark, 0, 1);
        dst[i + 2] = clamp(_cA.b * rutDark * 0.92, 0, 1);
      }
    } else {
      // winter: 路肩厚覆素雪，路芯薄雪积风纹，车辙露出较深冻土湿泥形成鲜明踏雪辙痕
      const up = clamp(ny, 0.15, 1);
      if (gDom > 0.18) {
        const snowF = (0.76 + 0.14 * nPatch) * up;
        dst[i] = lerpNum(sr, _cSnow.r, snowF);
        dst[i + 1] = lerpNum(sg, _cSnow.g, snowF);
        dst[i + 2] = lerpNum(sb, _cSnow.b, snowF);
      } else if (isRutBand && strongTracks) {
        // 压实车辙：寒湿暗土上覆薄霜，与路肩及中脊积雪拉开层次
        _cB.setRGB(sr, sg, sb).lerp(_cWinterMud, 0.48);
        const frostF = (0.28 + 0.22 * nPatch) * up;
        dst[i] = lerpNum(_cB.r, _cSnow.r, frostF);
        dst[i + 1] = lerpNum(_cB.g, _cSnow.g, frostF);
        dst[i + 2] = lerpNum(_cB.b, _cSnow.b, frostF);
      } else {
        const driftSnow = (0.58 + 0.24 * nPatch + 0.08 * nFine) * up;
        dst[i] = lerpNum(sr, _cSnow.r, driftSnow);
        dst[i + 1] = lerpNum(sg, _cSnow.g, driftSnow);
        dst[i + 2] = lerpNum(sb, _cSnow.b, driftSnow);
      }
    }
  }
  snap.geo.attributes.color.needsUpdate = true;
}
