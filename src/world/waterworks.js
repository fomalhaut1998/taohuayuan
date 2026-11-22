import * as THREE from 'three';
import { createHabitatContext, habitatSiteSafe, habitatSurface } from './habitat-details.js';
import { segmentDistance } from './hinterland.js';
import { stoneGeometry } from './model-geometry.js';

const TAU = Math.PI * 2;
const C = {
  wood: '#8F6943',
  cut: '#CAAA70',
  dark: '#5F523C',
  bamboo: '#A3A16A',
  joint: '#626F48',
  stone: '#8E9381',
  stoneDark: '#828876',
  moss: '#768E55',
  mossDark: '#6C834D',
  roadApron: '#B7A47F',
  water: '#91B8AD',
  waterDeep: '#7BA59A',
  foam: '#D1D9BF',
  soil: '#6F6950',
  mud: '#625A45',
  grain: '#C9B978',
  leaf: '#8D9B61',
};

const unwrap = v => v?.layout || v || {};

function boxDistance(x, z, b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.hw), Math.max(0, Math.abs(dx * s + dz * c) - b.hd));
}

function reserve(context, item) {
  if (!item || ![item.x, item.z].every(Number.isFinite)) return;
  if (Number.isFinite(item.radius ?? item.r)) context.reservations.circles.push({ x: item.x, z: item.z, r: item.radius ?? item.r });
  else if ([item.x, item.z, item.hw, item.hd].every(Number.isFinite)) context.reservations.boxes.push({ ...item });
}

function clear(context, x, z, r) {
  const { reservations: q, world, distanceToRiver } = context;
  const t = world.terrain;
  const meander = Math.sin(z * 0.017) * 2.4 + Math.sin(x * 0.013 + 1.7) * 1.6;
  if (t.pathOffset && Math.abs(distanceToRiver(x, z) - t.pathOffset - meander) < t.pathWidth + r + 0.6) return false;
  return (
    q.circles.every(a => Math.hypot(x - a.x, z - a.z) > r + a.r + 0.35) &&
    q.boxes.every(b => boxDistance(x, z, b) > r + 0.35) &&
    q.corridors.every(a => a.points.every((p, i, ps) => !i || segmentDistance(x, z, ps[i - 1], p) > r + a.half + 0.35))
  );
}

function strictlyDownhill(pts) {
  for (let i = 1; i < pts.length; i++) if (!(pts[i].y < pts[i - 1].y)) return false;
  return true;
}

function clearPath(context, field, pts, r = 0.30, minClear = 0.16) {
  for (let j = 1; j < pts.length; j++) {
    const u = pts[j - 1], w = pts[j];
    const n = Math.max(1, Math.ceil(Math.hypot(w.x - u.x, w.z - u.z) / 0.35));
    for (let k = 0; k <= n; k++) {
      const f = k / n, px = u.x + (w.x - u.x) * f, pz = u.z + (w.z - u.z) * f, py = u.y + (w.y - u.y) * f;
      if (!clear(context, px, pz, r) || py < habitatSurface(field, px, pz) + minClear) return false;
    }
  }
  return true;
}

/** Find the easternmost nearby farmland block with flooded paddies west of the wheel. */
function findTargetFieldBlock(world, field, wx, wz) {
  const blocks = world?.village?.fields?.blocks;
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const lift = world.village.fields.lift ?? 0.03;
  let best = null, bestDist = Infinity;
  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi], [pw, ph] = blk.plot, gap = blk.gap;
    const xMax = blk.x + blk.cols * pw + (blk.cols - 1) * gap;
    const zMin = blk.z - blk.rows * ph - (blk.rows - 1) * gap;
    if (xMax >= wx - 5 || wx - xMax > 28 || wz < zMin - 12 || wz > blk.z + 12) continue;
    let hiPaddy = null, loPaddy = null;
    for (let r = 0; r < blk.rows; r++) {
      for (let c = 0; c < blk.cols; c++) {
        if ((bi + r + c) % 3 === 0) continue;
        const x0 = blk.x + c * (pw + gap), z0 = blk.z - r * (ph + gap);
        const cx = x0 + pw * 0.5, cz = z0 - ph * 0.5;
        const waterY = field.sample(cx, cz) + lift + 0.036;
        const info = { r, c, x0, x1: x0 + pw, z0, z1: z0 - ph, cx, cz, waterY };
        if (c === blk.cols - 1 && (!hiPaddy || Math.abs(cz - wz) < Math.abs(hiPaddy.cz - wz))) hiPaddy = info;
        if (r === blk.rows - 1 && (!loPaddy || c === 0)) loPaddy = info;
      }
    }
    if (!hiPaddy || !loPaddy) continue;
    const d = Math.hypot(wx - xMax, wz - (blk.z + zMin) * 0.5);
    if (d < bestDist) {
      bestDist = d;
      best = { bi, blk, xMax, zMin, hiPaddy, loPaddy };
    }
  }
  return best;
}

/** Plan continuous farmland aqueduct, nursery bed, overflow rill, and stone tailrace canal. */
function planFarmlandNetwork(sStub, sp3, field, world, context) {
  const target = findTargetFieldBlock(world, field, sStub.x, sStub.z);
  if (!target) return null;
  const { xMax, zMin, hiPaddy, loPaddy } = target;
  const wp = (lx, ly, lz) => ({ x: sStub.x + sStub.flow.x * lx + sStub.axis.x * lz, y: ly, z: sStub.z + sStub.flow.z * lx + sStub.axis.z * lz });

  // Wheel catch basin ground range
  let maxBasinGround = -Infinity;
  for (let lx = -2.05; lx <= 1.35; lx += 0.42) {
    for (let lz = -0.90; lz <= 0.90; lz += 0.45) {
      const p = wp(lx, 0, lz);
      maxBasinGround = Math.max(maxBasinGround, habitatSurface(field, p.x, p.z));
    }
  }
  const basinY = Math.max(maxBasinGround + 0.06, 2.28);

  // Flooded seedling nursery bed in the clear meadow between wheel and road
  const bedX = xMax + 7.6, bedZ = zMin + 3.6;
  if (!habitatSiteSafe(bedX, bedZ, 1.6, context)) return null;
  let maxBedGround = -Infinity;
  for (let dx = -1.15; dx <= 1.15; dx += 0.38) {
    for (let dz = -1.35; dz <= 1.35; dz += 0.45) {
      maxBedGround = Math.max(maxBedGround, habitatSurface(field, bedX + dx, bedZ + dz));
    }
  }
  const bedY = Math.max(maxBedGround + 0.11, loPaddy.waterY + 0.13);
  const bed = { x: bedX, y: bedY, z: bedZ, radius: 1.6 };

  // 1. Elevated split-bamboo aqueduct from wheel crown over road into high rice paddy
  const p0 = wp(-0.68, sp3.y - 0.04, -0.72);
  const p1 = { x: 108.00, y: Math.min(p0.y - 0.24, 5.48), z: -80.20 };
  const p2 = { x: 104.00, y: Math.min(p1.y - 0.24, 5.22), z: -76.60 };
  const p3 = { x: 100.80, y: Math.min(p2.y - 0.22, 4.98), z: -72.80 };
  const p4 = { x: xMax + 0.30, y: Math.min(p3.y - 0.20, 4.76), z: hiPaddy.z1 + 2.50 };
  const p5 = { x: xMax + 0.10, y: Math.max(hiPaddy.waterY + 0.38, 2.74), z: hiPaddy.z1 + 2.62 };
  const p6 = { x: xMax - 0.95, y: Math.max(hiPaddy.waterY + 0.16, 2.52), z: hiPaddy.z1 + 2.75 };
  const aqueduct = [p0, p1, p2, p3, p4, p5, p6];

  // 2. Branch bamboo spout from trestle p2 to wet seedling nursery bed
  const b0 = { x: p2.x, y: p2.y - 0.04, z: p2.z };
  const b1 = { x: 104.22, y: 3.85, z: -78.30 };
  const b2 = { x: bed.x, y: Math.max(bed.y + 0.45, 2.58), z: bed.z + 0.95 };
  const branch = [b0, b1, b2];

  // 3. Overflow rill draining seedling nursery bed north into main stone canal
  const o0 = { x: bed.x, y: bed.y, z: bed.z - 1.15 };
  const o1 = { x: 104.10, y: bed.y - 0.015, z: -82.55 };
  const o2 = { x: 103.80, y: bed.y - 0.030, z: -83.55 };
  const overflow = [o0, o1, o2];

  // 4. Continuous stone tailrace canal from wheel catch basin under road culvert into low paddy
  const c0 = wp(0, basinY, -0.90);
  const c1 = { x: 110.20, y: Math.min(basinY - 0.06, 2.20), z: -82.70 };
  const c2 = { x: 107.00, y: Math.min(c1.y - 0.05, 2.14), z: -83.25 };
  const c3 = { x: o2.x, y: Math.min(c2.y - 0.04, o2.y), z: o2.z };
  const c4 = { x: 100.30, y: Math.min(c3.y - 0.03, 2.055), z: -83.60 };
  const c5 = { x: 98.40, y: Math.min(c4.y - 0.014, 2.040), z: -83.60 };
  const c6 = { x: xMax + 0.20, y: Math.min(c5.y - 0.014, 2.025), z: zMin - 0.25 };
  const c7 = { x: 93.00, y: Math.min(c6.y - 0.012, 2.012), z: zMin - 0.35 };
  const c8 = { x: 89.00, y: Math.min(c7.y - 0.009, 2.002), z: zMin - 0.42 };
  const c9 = { x: loPaddy.x1 - 1.20, y: Math.max(loPaddy.waterY + 0.009, 1.998), z: zMin - 0.38 };
  const c10 = { x: loPaddy.x1 - 1.80, y: Math.max(loPaddy.waterY + 0.005, 1.994), z: zMin + 0.60 };
  // Enforce exact monotonicity if low paddy water is higher than expected
  if (!(c8.y > c9.y && c9.y > c10.y)) return null;
  const canal = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10];

  if (![aqueduct, branch, overflow, canal].every(strictlyDownhill)) return null;
  // Meadow segments must clear all prior habitat/flora reservations and stay above terrain
  if (!clearPath(context, field, [p0, p1, p2, p3], 0.30, 0.20)) return null;
  if (!clearPath(context, field, branch, 0.30, 0.20)) return null;
  if (!clearPath(context, field, overflow, 0.25, 0.04)) return null;
  if (!clearPath(context, field, [c0, c1, c2, c3, c4], 0.30, 0.04)) return null;
  // Ensure canal water stays visibly above local terrain through the culvert and headland ditch
  for (const seg of [c4, c5, c6, c7, c8, c9, c10]) {
    if (seg.y < habitatSurface(field, seg.x, seg.z) + 0.04) return null;
  }

  return { mode: 'farmland', basinY, bed, hiPaddy, loPaddy, run: aqueduct, aqueduct, branch, overflow, canal };
}

function plan(options, context) {
  const { field, world } = options;
  const [cx, cz] = world.cliff.center;
  const candidates = [];
  const Rwheel = 1.45, clearance = 2.22; // clearance above local max ground keeps lowest bucket > 0.05m above terrain

  for (const deg of [35, 30, 40, 25, 10, 5, 350, 345, 340, 175, 180, 185]) {
    const rad = deg * Math.PI / 180;
    const out = { x: Math.cos(rad), z: Math.sin(rad) };
    const flow = { x: -out.z, z: out.x };
    const side = 1;
    const axis = { x: flow.z * side, z: -flow.x * side };
    for (const rW of [101, 98, 104, 95]) {
      const x = cx + out.x * rW, z = cz + out.z * rW;
      if (Math.hypot(x - cx, z - cz) >= world.cliff.radius - 18 || !clear(context, x, z, 3.2)) continue;
      let maxWGround = -Infinity;
      for (let k = 0; k < 12; k++) {
        const a = k * TAU / 12;
        for (const rr of [0, 1.0, Rwheel]) maxWGround = Math.max(maxWGround, habitatSurface(field, x + Math.cos(a) * rr, z + Math.sin(a) * rr));
      }
      const sY = maxWGround + 2.0; // wheel bottom ~ maxWGround + 0.52 (clean above ground & stone trough)
      for (let a = 8; a <= 13; a++) {
        const bank = { x: x + axis.x * a, z: z + axis.z * a };
        const mortar = { x: bank.x + flow.x * 3, z: bank.z + flow.z * 3 };
        const fallbackBed = { x: x - axis.x * 5.2 - flow.x * 2.4, z: z - axis.z * 5.2 - flow.z * 2.4 };
        if (![bank, mortar].every(q => habitatSiteSafe(q.x, q.z, 1.6, context))) continue;
        const mY = habitatSurface(field, mortar.x, mortar.z);
        const followerDepth = mY + 1.68 - sY - 0.27;
        if (followerDepth < 0.12 || followerDepth > 1.15) continue;

        const wp = (lx, ly, lz) => ({ x: x + flow.x * lx + axis.x * lz, y: ly, z: z + flow.z * lx + axis.z * lz });
        const springBase = wp(-4.5, 0, 19.0);
        if (!habitatSiteSafe(springBase.x, springBase.z, 1.8, context)) continue;
        const springGround = habitatSurface(field, springBase.x, springBase.z);
        const crownTop = sY + Rwheel + 0.08;
        const sp0 = { ...springBase, y: Math.max(springGround + 0.48, crownTop + 0.36) };
        const sp1 = wp(-3.1, sp0.y - 0.14, 13.0); sp1.y = Math.max(habitatSurface(field, sp1.x, sp1.z) + 0.26, sp1.y);
        const sp2 = wp(-1.8, sp0.y - 0.24, 6.6); sp2.y = Math.max(habitatSurface(field, sp2.x, sp2.z) + 0.26, crownTop + 0.12);
        const sp3 = wp(-0.68, crownTop, 0);
        if (!(sp0.y > sp1.y && sp1.y > sp2.y && sp2.y > sp3.y)) continue;
        const springRace = [sp0, sp1, sp2, sp3];
        if (!clearPath(context, field, springRace, 0.42, 0.18)) continue;

        const sStub = { x, y: sY, z, axis, flow };
        const net = planFarmlandNetwork(sStub, sp3, field, world, context);
        if (net) {
          candidates.push({
            deg, rW, side, x, y: sY, z, radius: Rwheel, axleRadius: clearance, axis, flow, maxWGround,
            bank: { ...bank, y: habitatSurface(field, bank.x, bank.z) },
            mortar: { ...mortar, y: mY },
            spring: { ...sp0, ground: springGround, radius: 1.5 },
            springRace,
            axleLength: a,
            followerDepth,
            ...net,
          });
          break;
        }

        // Fallback short run + local grain bed when no village paddy block lies nearby (synthetic fixtures)
        if (!habitatSiteSafe(fallbackBed.x, fallbackBed.z, 1.6, context)) continue;
        const bedY = habitatSurface(field, fallbackBed.x, fallbackBed.z) + 0.48;
        const run0 = wp(-0.68, sp3.y - 0.04, -0.72);
        const run1 = wp(-1.7, Math.max(bedY + 1.15, sY + 0.25), -2.8);
        const run2 = { ...fallbackBed, y: bedY + 0.35 };
        if (!(run0.y > run1.y && run1.y > run2.y)) continue;
        const run = [run0, run1, run2];
        if (!clearPath(context, field, run, 0.42, 0.18)) continue;
        candidates.push({
          deg, rW, side, x, y: sY, z, radius: Rwheel, axleRadius: clearance, axis, flow, maxWGround,
          mode: 'fallback',
          basinY: maxWGround + 0.04,
          bank: { ...bank, y: habitatSurface(field, bank.x, bank.z) },
          bed: { ...fallbackBed, y: bedY, radius: 1.6 },
          mortar: { ...mortar, y: mY },
          spring: { ...sp0, ground: springGround, radius: 1.5 },
          springRace,
          run,
          axleLength: a,
          followerDepth,
        });
        break;
      }
    }
  }
  candidates.sort((a, b) => a.axleLength - b.axleLength || a.deg - b.deg);
  return candidates[0] || null;
}

// One opaque, vertex-coloured batch per moving assembly; construction geometries never escape.
function builder() {
  const positions = [], colors = [];
  return {
    add(geometry, color, matrix = new THREE.Matrix4()) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.applyMatrix4(matrix);
      const a = g.attributes.position, c = new THREE.Color(color);
      for (let i = 0; i < a.count; i++) {
        positions.push(a.getX(i), a.getY(i), a.getZ(i));
        colors.push(c.r, c.g, c.b);
      }
      g.dispose();
      geometry.dispose();
    },
    mesh(name) {
      if (!positions.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
      m.name = name;
      return m;
    },
  };
}

function matrix(x, y, z, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
}

function box(b, x, y, z, w, h, d, c, rz = 0, ry = 0) {
  b.add(new THREE.BoxGeometry(w, h, d), c, matrix(x, y, z, 0, ry, rz));
}

function rod(b, a, d, r, c, sides = 6) {
  const u = new THREE.Vector3(...a), v = new THREE.Vector3(...d), delta = v.clone().sub(u);
  if (delta.length() < 1e-6) return;
  const m = new THREE.Matrix4().compose(
    u.add(v).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  b.add(new THREE.CylinderGeometry(r, r, delta.length(), sides), c, m);
}

/** Open-ended cylinder rod: 8 tris at sides=4 instead of 16, keeping triangles lean. */
function openRod(b, a, d, r, c, sides = 4) {
  const u = new THREE.Vector3(...a), v = new THREE.Vector3(...d), delta = v.clone().sub(u);
  if (delta.length() < 1e-6) return;
  const m = new THREE.Matrix4().compose(
    u.add(v).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  b.add(new THREE.CylinderGeometry(r, r, delta.length(), sides, 1, true), c, m);
}

function tri(b, p0, p1, p2, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2], 3));
  b.add(g, c);
}

function quad(b, p0, p1, p2, p3, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3));
  b.add(g, c);
}

function foamRing(b, x, y, z, rIn, rOut, c, segs = 8) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    quad(
      b,
      [x + Math.cos(a0) * rIn, y, z + Math.sin(a0) * rIn],
      [x + Math.cos(a0) * rOut, y, z + Math.sin(a0) * rOut],
      [x + Math.cos(a1) * rOut, y, z + Math.sin(a1) * rOut],
      [x + Math.cos(a1) * rIn, y, z + Math.sin(a1) * rIn],
      c,
    );
  }
}

function ring(b, x, y, z, r, t, c, rx = 0) {
  b.add(new THREE.TorusGeometry(r, t, 3, 16), c, matrix(x, y, z, rx));
}

function vessel(b, x, y, z, r, h, c) {
  const pts = [[0, 0], [r * 0.72, 0], [r, h], [r * 0.78, h], [r * 0.55, h * 0.18], [0, h * 0.18]].map(p => new THREE.Vector2(...p));
  b.add(new THREE.LatheGeometry(pts, 8), c, matrix(x, y, z));
}

function pipe(b, a, d, r = 0.21) {
  const dx = d.x - a.x, dz = d.z - a.z, len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const nx = dz / len, nz = -dx / len, vertices = [];
  // A true upward-facing U: both lips at y=0, bottom at -r, never a sideways half-cylinder.
  const p = (q, angle) => [q.x + nx * Math.cos(angle) * r, q.y - Math.sin(angle) * r, q.z + nz * Math.cos(angle) * r];
  const slices = 5;
  for (let i = 0; i < slices; i++) {
    const lo = i * Math.PI / slices, hi = (i + 1) * Math.PI / slices;
    vertices.push(...p(a, lo), ...p(d, lo), ...p(a, hi), ...p(a, hi), ...p(d, lo), ...p(d, hi));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  b.add(g, C.bamboo);
  for (const side of [-1, 1]) openRod(b, [a.x + nx * r * side, a.y, a.z + nz * r * side], [d.x + nx * r * side, d.y, d.z + nz * r * side], 0.032, C.joint, 4);
}

/** Grounded stone-masonry canal with outer mossy earth shoulders and downhill water sheet. */
function canalRibbon(staticB, wetB, field, pts, widths, skipDeckSpans = [], skipWallSpans = []) {
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(segLen / 1.4));
    const wa = widths[i], wb = widths[i + 1];
    for (let k = (i === 0 ? 0 : 1); k <= steps; k++) {
      const f = k / steps;
      samples.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        hw: wa.hw + (wb.hw - wa.hw) * f,
        wallW: wa.wallW + (wb.wallW - wa.wallW) * f,
        skirtW: wa.skirtW + (wb.skirtW - wa.skirtW) * f,
      });
    }
  }
  const dirs = samples.map((p, idx) => {
    const prev = samples[Math.max(0, idx - 1)], next = samples[Math.min(samples.length - 1, idx + 1)];
    const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
    return { nx: dz / len, nz: -dx / len };
  });
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1], da = dirs[i], db = dirs[i + 1];
    const mx = (a.x + b.x) * 0.5;
    const underDeck = skipDeckSpans.some(([x0, x1]) => mx >= x0 && mx <= x1);
    const pt = (s, d, off, y) => [s.x + d.nx * off, y, s.z + d.nz * off];
    const gPt = (s, d, off) => {
      const px = s.x + d.nx * off, pz = s.z + d.nz * off;
      return [px, habitatSurface(field, px, pz) - 0.14, pz];
    };
    const wA = a.hw, wB = b.hw;
    quad(wetB, pt(a, da, -wA, a.y), pt(a, da, wA, a.y), pt(b, db, wB, b.y), pt(b, db, -wB, b.y), i % 3 === 0 ? C.waterDeep : C.water);
    if (underDeck) continue;
    const rimA = a.y + 0.085, rimB = b.y + 0.085;
    const floorA = Math.min(a.y - 0.11, habitatSurface(field, a.x, a.z) - 0.06);
    const floorB = Math.min(b.y - 0.11, habitatSurface(field, b.x, b.z) - 0.06);
    const stoneCol = i % 2 === 0 ? C.stone : C.stoneDark;
    const earthCol = i % 2 === 0 ? C.moss : C.mossDark;
    for (const side of [-1, 1]) {
      if (skipWallSpans.some(s => s.side === side && mx >= s.x0 && mx <= s.x1)) continue;
      const i0 = side * a.hw, i1 = side * b.hw;
      const r0 = side * (a.hw + a.wallW), r1 = side * (b.hw + b.wallW);
      const o0 = side * (a.hw + a.wallW + a.skirtW), o1 = side * (b.hw + b.wallW + b.skirtW);
      if (side > 0) {
        quad(staticB, pt(a, da, i0, floorA), pt(a, da, i0, rimA), pt(b, db, i1, rimB), pt(b, db, i1, floorB), stoneCol);
        quad(staticB, pt(a, da, i0, rimA), pt(a, da, r0, rimA), pt(b, db, r1, rimB), pt(b, db, i1, rimB), stoneCol);
        quad(staticB, pt(a, da, r0, rimA), gPt(a, da, o0), gPt(b, db, o1), pt(b, db, r1, rimB), earthCol);
      } else {
        quad(staticB, pt(a, da, i0, rimA), pt(a, da, i0, floorA), pt(b, db, i1, floorB), pt(b, db, i1, rimB), stoneCol);
        quad(staticB, pt(a, da, r0, rimA), pt(a, da, i0, rimA), pt(b, db, i1, rimB), pt(b, db, r1, rimB), stoneCol);
        quad(staticB, gPt(a, da, o0), pt(a, da, r0, rimA), pt(b, db, r1, rimB), gPt(b, db, o1), earthCol);
      }
    }
  }
}

function trapShape(b, x, y, z) {
  const n = 16, L = 1.65;
  for (let i = 0; i < n; i++) {
    const a = i * TAU / n, c = Math.cos(a), s = Math.sin(a);
    rod(b, [x + c * 0.48, y + s * 0.48, z], [x + c * 0.32, y + s * 0.32, z + L], 0.022, C.bamboo, 4);
    rod(b, [x + c * 0.46, y + s * 0.46, z], [x + c * 0.09, y + s * 0.09, z + 0.62], 0.018, C.cut, 4);
  }
  for (let j = 0; j < 7; j++) ring(b, x, y, z + j * L / 6, 0.48 - j * 0.16 / 6, 0.023, j % 2 ? C.dark : C.bamboo);
  ring(b, x, y, z + 0.62, 0.09, 0.025, C.dark); // inward cone's small open throat, never a flat capped cylinder
}

// The follower foot is on the actual eccentric cam, not a second animation curve.
function leverAngle(phase, s) {
  const h = s.followerDepth, base = s.mortar.y + 1.68, cx = 0.19 * Math.cos(phase), cy = s.y + 0.19 * Math.sin(phase);
  let lo = 0, hi = 0.7;
  for (let i = 0; i < 40; i++) {
    const a = (lo + hi) / 2, x = -0.8 + 0.8 * Math.cos(a) + h * Math.sin(a), y = base + 0.8 * Math.sin(a) - h * Math.cos(a);
    if (Math.hypot(x - cx, y - cy) > 0.46) hi = a;
    else lo = a;
  }
  return (lo + hi) / 2;
}

export function createWaterworks(options) {
  const group = new THREE.Group();
  group.name = 'waterworks';
  const blockers = [], targets = [], stations = [];
  const layout = { wheels: [], traps: [], beds: [], conduits: [], springs: [], springRaces: [], reservations: [], rejected: [] };
  let disposed = false, sound = options.sound || null, phase = 0, impacts = 0, played = 0;

  const context = options.field && options.riverCurve && options.distanceToRiver && options.flora && options.boats && options.cliff
    ? createHabitatContext(options)
    : null;
  if (context) for (const a of unwrap(options.habitatDetails).clusters || []) reserve(context, a);
  for (const source of (Array.isArray(options.reservations) ? options.reservations : [options.reservations]).filter(Boolean)) {
    if (!context) break;
    for (const item of (Array.isArray(source) ? source : unwrap(source).reservations || [])) reserve(context, item);
    for (const b of source?.blockers || []) reserve(context, b);
  }

  const cfg = { enabled: true, maxTriangles: 11000, ...options.world.waterworks };
  const required = ['field', 'riverCurve', 'flora', 'boats', 'cliff', 'hinterland', 'village', 'villageScenes', 'villageLife', 'props', 'exterior', 'habitatDetails'];
  const complete = !!context && required.every(k => options[k]);
  const staticB = builder(), wetB = builder(), dropMatrix = new THREE.Matrix4();
  let wheel = null, pestle = null, waterMesh = null, drops = null;
  let springWaterPath = [], aqueductWaterPath = [], branchWaterPath = [], canalWaterPath = [];

  const worldPoint = (s, x, y, z) => ({ x: s.x + s.flow.x * x + s.axis.x * z, y, z: s.z + s.flow.z * x + s.axis.z * z });
  const addBlock = (x, z, hw, hd, rot, minY, maxY) => blockers.push({ x, z, hw, hd, rot, minY, maxY });
  const addReserve = (x, z, radius) => layout.reservations.push({ x, z, radius });
  const mark = (id, p, range = 4) => targets.push({ id, x: p.x, y: p.y, z: p.z, range });

  const buildCatchBasin = (s, basinY) => {
    const wp = (lx, ly, lz) => worldPoint(s, lx, ly, lz);
    const wallTop = basinY + 0.11, wallBot = basinY - 0.12;
    const pW = (lx, ly, lz) => { const p = wp(lx, ly, lz); return [p.x, p.y, p.z]; };
    const pG = (lx, lz) => { const p = wp(lx, 0, lz); return [p.x, habitatSurface(options.field, p.x, p.z) - 0.14, p.z]; };
    // Turquoise catch basin water below wheel (wheel buckets clear basin rim by > 0.30m)
    quad(wetB, pW(-2.05, basinY, -0.88), pW(-2.05, basinY, 0.88), pW(1.35, basinY, 0.88), pW(1.35, basinY, -0.88), C.water);
    quad(wetB, pW(-1.6, basinY + 0.008, -0.45), pW(-1.6, basinY + 0.008, 0.45), pW(0.85, basinY + 0.008, 0.45), pW(0.85, basinY + 0.008, -0.45), C.waterDeep);
    // Grounded stone basin walls & outer mossy earth slopes (leaving NW outlet notch lx in [-0.46, 0.46])
    const wallSeg = (ax, az, bx, bz, nx, nz, col, earthCol) => {
      const t = 0.16, sk = 0.42;
      quad(staticB, pW(ax, wallBot, az), pW(ax, wallTop, az), pW(bx, wallTop, bz), pW(bx, wallBot, bz), col);
      quad(staticB, pW(ax, wallTop, az), pW(ax + nx * t, wallTop, az + nz * t), pW(bx + nx * t, wallTop, bz + nz * t), pW(bx, wallTop, bz), col);
      quad(staticB, pW(ax + nx * t, wallTop, az + nz * t), pG(ax + nx * (t + sk), az + nz * (t + sk)), pG(bx + nx * (t + sk), bz + nz * (t + sk)), pW(bx + nx * t, wallTop, bz + nz * t), earthCol);
    };
    wallSeg(-2.05, -0.88, -2.05, 0.88, -1, 0, C.stone, C.moss);
    wallSeg(-2.05, 0.88, 1.35, 0.88, 0, 1, C.stoneDark, C.mossDark);
    wallSeg(1.35, 0.88, 1.35, -0.88, 1, 0, C.stone, C.moss);
    wallSeg(-0.46, -0.88, -2.05, -0.88, 0, -1, C.stoneDark, C.moss);
    wallSeg(1.35, -0.88, 0.46, -0.88, 0, -1, C.stone, C.mossDark);
    // Four grounded foothill boulders anchoring the catch basin corners & piers
    for (const [j, lx, lz, sc] of [[0, -2.15, 0.95, 0.42], [1, 1.45, 0.92, 0.36], [2, -1.95, -0.95, 0.34], [3, 1.32, -0.96, 0.32]]) {
      const bp = wp(lx, 0, lz), g = stoneGeometry(733 + j * 41), pos = g.attributes.position;
      g.rotateY(j * 1.1);
      g.computeBoundingBox();
      const lo = g.boundingBox.min.y, hi = g.boundingBox.max.y, topY = basinY + 0.16 + 0.08 * (j % 2);
      for (let i = 0; i < pos.count; i++) {
        const px = bp.x + pos.getX(i) * sc, pz = bp.z + pos.getZ(i) * sc;
        const fl = habitatSurface(options.field, px, pz) - 0.05, u = (pos.getY(i) - lo) / (hi - lo);
        pos.setXYZ(i, px, fl + u * Math.max(0.28, topY - fl), pz);
      }
      staticB.add(g, j % 2 ? C.stone : C.stoneDark);
    }
  };

  const buildTrestle = (p, spanDir, isPortal) => {
    const fl = habitatSurface(options.field, p.x, p.z) - 0.05;
    const len = Math.hypot(spanDir.x, spanDir.z) || 1;
    const nx = spanDir.z / len, nz = -spanDir.x / len;
    const s = isPortal ? 0.36 : 0.30, botS = isPortal ? 0.44 : 0.56;
    const capY = p.y - 0.21;
    for (const side of [-1, 1]) {
      const tx = p.x + nx * side * s, tz = p.z + nz * side * s;
      const bx = p.x + nx * side * botS, bz = p.z + nz * side * botS;
      const gf = habitatSurface(options.field, bx, bz) - 0.04;
      openRod(staticB, [bx, gf, bz], [tx, capY, tz], isPortal ? 0.085 : 0.072, C.wood, 4);
      box(staticB, bx, gf + 0.07, bz, 0.28, 0.14, 0.28, C.stoneDark);
      if (isPortal) openRod(staticB, [tx, capY - 0.65, tz], [p.x, capY, p.z], 0.052, C.dark, 4);
    }
    const crossH = isPortal ? capY : fl + (capY - fl) * 0.45;
    const crossSpan = isPortal ? s + 0.16 : s + 0.12;
    openRod(staticB, [p.x - nx * crossSpan, crossH, p.z - nz * crossSpan], [p.x + nx * crossSpan, crossH, p.z + nz * crossSpan], 0.058, C.dark, 4);
    if (isPortal) {
      openRod(staticB, [p.x - nx * (s + 0.14), capY, p.z - nz * (s + 0.14)], [p.x + nx * (s + 0.14), capY, p.z + nz * (s + 0.14)], 0.078, C.wood, 4);
    } else {
      openRod(staticB, [p.x - nx * (s + 0.06), capY, p.z - nz * (s + 0.06)], [p.x + nx * (s + 0.06), capY, p.z + nz * (s + 0.06)], 0.062, C.cut, 4);
    }
    addBlock(p.x, p.z, 0.13, 0.13, 0, fl, capY);
  };

  const buildAqueductAndDrop = (s, spLip) => {
    const [p0, p1, p2, p3, p4, p5, p6] = s.aqueduct;
    // Wooden catch header box at wheel crown + bamboo trough spans over qian-east
    box(staticB, p0.x, p0.y - 0.12, p0.z, 0.46, 0.22, 0.44, C.wood);
    pipe(staticB, spLip, p0, 0.16);
    openRod(wetB, [spLip.x, spLip.y + 0.02, spLip.z], [p0.x, p0.y + 0.02, p0.z], 0.065, C.water, 4);

    const overhead = [p0, p1, p2, p3, p4];
    for (let i = 1; i < overhead.length; i++) {
      const a = overhead[i - 1], b = overhead[i];
      pipe(staticB, a, b, 0.20);
      openRod(wetB, [a.x, a.y + 0.02, a.z], [b.x, b.y + 0.02, b.z], 0.075, C.water, 4);
    }
    buildTrestle(p1, { x: p2.x - p0.x, z: p2.z - p0.z }, false);
    buildTrestle(p2, { x: p3.x - p1.x, z: p3.z - p1.z }, false);
    buildTrestle(p3, { x: p4.x - p2.x, z: p4.z - p2.z }, true);
    // Wooden joint catch-boxes at bends & chute inlet so bamboo troughs seat cleanly without miter gaps
    for (const jp of [p1, p3, p4]) box(staticB, jp.x, jp.y - 0.11, jp.z, 0.42, 0.22, 0.42, C.wood);

    // West-of-road drop-chute tower on east bund shoulder (zero blockers on road or Block 1)
    const towerG = habitatSurface(options.field, p4.x, p4.z) - 0.05;
    for (const dz of [-0.24, 0.24]) {
      openRod(staticB, [p4.x, towerG, p4.z + dz], [p4.x, p4.y - 0.10, p4.z + dz], 0.078, C.wood, 4);
      box(staticB, p4.x, towerG + 0.07, p4.z + dz, 0.24, 0.14, 0.24, C.stoneDark);
    }
    // Vertical timber baffle drop-chute from p4 (4.76) down to p5 (2.74)
    const midChuteY = (p4.y + p5.y) * 0.5;
    const chuteH = p4.y - p5.y + 0.24;
    box(staticB, p4.x + 0.12, midChuteY, p4.z, 0.08, chuteH, 0.42, C.dark);
    for (const dz of [-0.19, 0.19]) box(staticB, p4.x - 0.04, midChuteY, p4.z + dz, 0.32, chuteH, 0.06, C.wood);
    for (const f of [0.28, 0.56, 0.82]) box(staticB, p4.x - 0.02, p5.y + (p4.y - p5.y) * f, p4.z, 0.24, 0.06, 0.34, C.cut);
    openRod(wetB, [p4.x - 0.08, p4.y, p4.z], [p5.x + 0.05, p5.y + 0.04, p5.z], 0.085, C.foam, 4);
    box(staticB, p5.x, p5.y - 0.11, p5.z, 0.40, 0.20, 0.40, C.wood);

    // Angled bamboo delivery spout crossing east bund into Block 1 (r=0,c=1) rice paddy
    pipe(staticB, p5, p6, 0.16);
    openRod(wetB, [p5.x, p5.y + 0.02, p5.z], [p6.x, p6.y + 0.02, p6.z], 0.06, C.water, 4);
    const paddyY = s.hiPaddy.waterY;
    openRod(wetB, [p6.x, p6.y, p6.z], [p6.x, paddyY, p6.z], 0.065, C.foam, 4);
    foamRing(wetB, p6.x, paddyY + 0.022, p6.z, 0.10, 0.36, C.foam, 8);
    foamRing(wetB, p6.x, paddyY + 0.018, p6.z, 0.42, 0.62, C.water, 8);
  };

  const buildNurseryAndBranch = s => {
    const [b0, b1, b2] = s.branch;
    box(staticB, b0.x, b0.y - 0.08, b0.z, 0.36, 0.18, 0.36, C.wood);
    pipe(staticB, b0, b1, 0.15);
    pipe(staticB, b1, b2, 0.15);
    openRod(wetB, [b0.x, b0.y + 0.02, b0.z], [b1.x, b1.y + 0.02, b1.z], 0.055, C.water, 4);
    openRod(wetB, [b1.x, b1.y + 0.02, b1.z], [b2.x, b2.y + 0.02, b2.z], 0.055, C.water, 4);
    const b1g = habitatSurface(options.field, b1.x, b1.z) - 0.04;
    for (const dx of [-0.22, 0.22]) openRod(staticB, [b1.x + dx, b1g, b1.z], [b1.x, b1.y - 0.15, b1.z], 0.055, C.bamboo, 4);
    addBlock(b1.x, b1.z, 0.13, 0.13, 0, b1g, b1.y - 0.15);

    const bed = s.bed;
    openRod(wetB, [b2.x, b2.y, b2.z], [b2.x, bed.y, b2.z], 0.055, C.foam, 4);
    foamRing(wetB, b2.x, bed.y + 0.016, b2.z, 0.08, 0.28, C.foam, 8);

    // Flooded stone-and-mud seedling nursery terrace (2.1m x 2.5m inner mirror)
    const hx = 1.05, hz = 1.25, wWall = 0.22, sk = 0.30, topY = bed.y + 0.085, botY = bed.y - 0.10;
    quad(wetB, [bed.x - hx, bed.y, bed.z + hz], [bed.x + hx, bed.y, bed.z + hz], [bed.x + hx, bed.y, bed.z - hz], [bed.x - hx, bed.y, bed.z - hz], C.water);
    const pSurf = (px, pz) => [px, habitatSurface(options.field, px, pz) - 0.12, pz];
    const bundSeg = (ax, az, bx, bz, nx, nz, col) => {
      quad(staticB, [ax, botY, az], [ax, topY, az], [bx, topY, bz], [bx, botY, bz], col);
      quad(staticB, [ax, topY, az], [ax + nx * wWall, topY, az + nz * wWall], [bx + nx * wWall, topY, bz + nz * wWall], [bx, topY, bz], C.moss);
      quad(staticB, [ax + nx * wWall, topY, az + nz * wWall], pSurf(ax + nx * (wWall + sk), az + nz * (wWall + sk)), pSurf(bx + nx * (wWall + sk), bz + nz * (wWall + sk)), [bx + nx * wWall, topY, bz + nz * wWall], C.soil);
    };
    bundSeg(bed.x - hx, bed.z - hz, bed.x - hx, bed.z + hz, -1, 0, C.mud);
    bundSeg(bed.x - hx, bed.z + hz, bed.x + hx, bed.z + hz, 0, 1, C.stoneDark);
    bundSeg(bed.x + hx, bed.z + hz, bed.x + hx, bed.z - hz, 1, 0, C.mud);
    // North bund split around overflow weir notch at bed.x
    bundSeg(bed.x + hx, bed.z - hz, bed.x + 0.16, bed.z - hz, 0, -1, C.stone);
    bundSeg(bed.x - 0.16, bed.z - hz, bed.x - hx, bed.z - hz, 0, -1, C.stone);

    // Twelve lush splayed rice-seedling tussocks emerging from the nursery water
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 4; iz++) {
        const px = bed.x - 0.62 + ix * 0.62, pz = bed.z - 0.84 + iz * 0.56;
        const ang = ix * 1.9 + iz * 2.4, ca = Math.cos(ang), sa = Math.sin(ang);
        openRod(staticB, [px, bed.y - 0.04, pz], [px - ca * 0.08, bed.y + 0.44, pz - sa * 0.08], 0.017, C.leaf, 3);
        openRod(staticB, [px, bed.y - 0.04, pz], [px + ca * 0.08, bed.y + 0.48, pz + sa * 0.08], 0.017, C.leaf, 3);
        openRod(staticB, [px, bed.y + 0.42, pz], [px + Math.cos(ang + 0.7) * 0.11, bed.y + 0.63, pz + Math.sin(ang + 0.7) * 0.11], 0.028, C.grain, 3);
      }
    }
    mark('bamboo-irrigation', { x: bed.x + 0.74, y: bed.y + 0.68, z: bed.z + 0.86 }, 4.5);
    addReserve(bed.x, bed.z, 1.65);

    // Stone-lined overflow rill draining nursery bed into main tailrace canal T-junction (walls stop at canal inner edge)
    const c3 = s.canal[3];
    const rillEndZ = c3.z + 0.36;
    const rillPts = [
      { x: s.overflow[0].x, y: s.overflow[0].y, z: s.bed.z - 1.25 },
      s.overflow[1],
      { x: c3.x, y: c3.y + 0.004, z: rillEndZ },
    ];
    canalRibbon(staticB, wetB, options.field, rillPts, rillPts.map(() => ({ hw: 0.13, wallW: 0.09, skirtW: 0.22 })));
    quad(
      wetB,
      [c3.x - 0.13, c3.y + 0.004, rillEndZ],
      [c3.x + 0.13, c3.y + 0.004, rillEndZ],
      [c3.x + 0.13, c3.y, c3.z],
      [c3.x - 0.13, c3.y, c3.z],
      C.water,
    );
  };

  const buildCanalAndCrossings = s => {
    // 1. Stone-banked tailrace canal from catch basin (c0) to Block 1 north bund (c9),
    // with exact visual knots at T-junction & bridge edges so wall openings align cleanly.
    const c = s.canal;
    const lerpPt = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
    const ox = s.overflow[2].x;
    const fT1 = (ox + 0.26 - c[2].x) / (c[3].x - c[2].x);
    const fT2 = (ox - 0.26 - c[3].x) / (c[4].x - c[3].x);
    const fB1 = (99.15 - c[4].x) / (c[5].x - c[4].x);
    const fS1 = (87.80 - c[8].x) / (c[9].x - c[8].x);
    const fS2 = (87.00 - c[8].x) / (c[9].x - c[8].x);
    const cVis = [
      c[0], c[1], c[2],
      lerpPt(c[2], c[3], fT1),
      c[3],
      lerpPt(c[3], c[4], fT2),
      c[4],
      lerpPt(c[4], c[5], fB1),
      c[5],
      { x: 97.65, y: (c[5].y + c[6].y) * 0.5, z: c[5].z },
      c[6], c[7], c[8],
      lerpPt(c[8], c[9], fS1),
      lerpPt(c[8], c[9], fS2),
      c[9],
    ];
    const widths = cVis.map(p => {
      if (p.x >= 103.0) return { hw: 0.36, wallW: 0.13, skirtW: 0.26 };
      if (p.x >= 97.4) return { hw: 0.30, wallW: 0.12, skirtW: 0.22 };
      return { hw: 0.18, wallW: 0.10, skirtW: 0.18 };
    });
    // Open south stone wall (+Z, side=1) at overflow confluence & skip coping under road/footpath bridges
    canalRibbon(
      staticB,
      wetB,
      options.field,
      cVis,
      widths,
      [[97.65, 99.15], [87.00, 87.80]],
      [{ side: 1, x0: ox - 0.27, x1: ox + 0.27 }],
    );

    // 2. Timber plank culvert bridge over canal at qian-east road crossing (98.40, -83.60)
    const bx = 98.40, bz = -83.60, bridgeY = 2.095;
    for (const dz of [-0.44, 0.44]) {
      const fl = habitatSurface(options.field, bx, bz + dz) - 0.06;
      box(staticB, bx, (fl + bridgeY) * 0.5 - 0.015, bz + dz, 1.54, bridgeY - fl, 0.18, C.stoneDark);
    }
    for (let i = 0; i < 5; i++) {
      const px = bx - 0.60 + i * 0.30;
      box(staticB, px, bridgeY, bz, 0.26, 0.048, 1.12, i % 2 === 0 ? C.wood : C.dark);
    }
    for (const dir of [-1, 1]) {
      const zIn = bz + dir * 0.56, zOut = bz + dir * 1.15;
      const yOutL = habitatSurface(options.field, bx - 0.72, zOut) - 0.01;
      const yOutR = habitatSurface(options.field, bx + 0.72, zOut) - 0.01;
      const yInL = habitatSurface(options.field, bx - 0.72, zIn) - 0.02;
      const yInR = habitatSurface(options.field, bx + 0.72, zIn) - 0.02;
      quad(staticB, [bx - 0.72, bridgeY + 0.015, zIn], [bx + 0.72, bridgeY + 0.015, zIn], [bx + 0.72, yOutR, zOut], [bx - 0.72, yOutL, zOut], C.roadApron);
      tri(staticB, [bx - 0.72, yInL, zIn], [bx - 0.72, bridgeY + 0.015, zIn], [bx - 0.72, yOutL, zOut], C.stoneDark);
      tri(staticB, [bx + 0.72, bridgeY + 0.015, zIn], [bx + 0.72, yInR, zIn], [bx + 0.72, yOutR, zOut], C.stoneDark);
      box(staticB, bx + dir * 0.70, bridgeY + 0.075, bz + dir * 0.48, 0.13, 0.14, 0.13, C.stone);
    }

    // 3. Field-corner stone diversion weir & wooden sluice gate at c6 (NE corner of Block 1), aligned with canal tangent
    const gPrev = s.canal[5], gPt = s.canal[6], gNext = s.canal[7];
    const yawGate = Math.atan2(-(gNext.z - gPrev.z), gNext.x - gPrev.x);
    const gxN = -Math.sin(yawGate), gzN = -Math.cos(yawGate);
    const gFl = habitatSurface(options.field, gPt.x, gPt.z) - 0.06;
    for (const sOff of [-0.26, 0.26]) {
      const px = gPt.x + gxN * sOff, pz = gPt.z + gzN * sOff;
      box(staticB, px, (gFl + gPt.y + 0.46) * 0.5, pz, 0.11, gPt.y + 0.46 - gFl, 0.11, C.dark, 0, yawGate);
      box(staticB, px, (gFl + gPt.y + 0.14) * 0.5, pz, 0.36, gPt.y + 0.14 - gFl, 0.15, C.stoneDark, 0, yawGate);
    }
    box(staticB, gPt.x, gPt.y + 0.44, gPt.z, 0.10, 0.10, 0.66, C.wood, 0, yawGate);
    box(staticB, gPt.x, gPt.y + 0.21, gPt.z, 0.06, 0.26, 0.44, C.cut, 0, yawGate);
    foamRing(wetB, gPt.x + Math.cos(yawGate) * 0.20, gPt.y + 0.018, gPt.z - Math.sin(yawGate) * 0.20, 0.04, 0.18, C.foam, 6);

    // 4. Bluestone slab footpath bridge where inter-b1-c0 crosses headland ditch (x = 87.40, z = -84.42)
    const sx = 87.40, sz = -84.42, slabY = 2.085;
    for (const dz of [-0.30, 0.30]) {
      const sf = habitatSurface(options.field, sx, sz + dz) - 0.05;
      box(staticB, sx, (sf + slabY) * 0.5, sz + dz, 0.88, slabY - sf, 0.16, C.stoneDark);
    }
    box(staticB, sx, slabY + 0.025, sz, 0.84, 0.06, 0.78, C.stone);
    for (const dir of [-1, 1]) {
      const zIn = sz + dir * 0.39, zOut = sz + dir * 0.72;
      const yOut = habitatSurface(options.field, sx, zOut) + 0.006;
      quad(staticB, [sx - 0.40, slabY + 0.045, zIn], [sx + 0.40, slabY + 0.045, zIn], [sx + 0.40, yOut, zOut], [sx - 0.40, yOut, zOut], C.roadApron);
    }

    // 5. Wooden paddy inlet box through north bund pouring directly into Block 1 (r=1,c=0) paddy
    const cIn = s.canal[9], cOut = s.canal[10];
    const chX = (cIn.x + cOut.x) * 0.5, chZ = (cIn.z + cOut.z) * 0.5, yawIn = Math.atan2(cOut.x - cIn.x, cOut.z - cIn.z);
    box(staticB, chX, cOut.y - 0.03, chZ, 0.46, 0.07, 1.24, C.wood, 0, yawIn);
    for (const side of [-0.22, 0.22]) {
      box(staticB, chX + Math.cos(yawIn) * side, cOut.y + 0.06, chZ - Math.sin(yawIn) * side, 0.06, 0.16, 1.24, C.dark, 0, yawIn);
    }
    quad(
      wetB,
      [cIn.x - 0.17, cIn.y + 0.008, cIn.z - 0.12],
      [cIn.x + 0.17, cIn.y + 0.008, cIn.z - 0.12],
      [cOut.x + 0.17, cOut.y + 0.006, cOut.z],
      [cOut.x - 0.17, cOut.y + 0.006, cOut.z],
      C.water,
    );
    foamRing(wetB, cOut.x, s.loPaddy.waterY + 0.018, cOut.z + 0.10, 0.08, 0.34, C.foam, 8);
    foamRing(wetB, cOut.x, s.loPaddy.waterY + 0.014, cOut.z + 0.10, 0.38, 0.56, C.water, 8);
  };

  const build = () => {
    const s = plan(options, context);
    if (!s) {
      layout.rejected.push('no-clear-hydraulic-site');
      return;
    }
    layout.wheels.push(s);
    layout.beds.push({ ...s.bed, kind: 'new-demonstration-grain-bed' });
    layout.springs.push({ ...s.spring });
    layout.springRaces.push({ points: s.springRace.map(p => ({ ...p })), downhill: true });
    if (s.mode === 'farmland') {
      layout.conduits.push(
        { kind: 'aqueduct', points: s.aqueduct.map(p => ({ ...p })), downhill: true, feeds: 'village-paddy-high' },
        { kind: 'branch', points: s.branch.map(p => ({ ...p })), downhill: true, feeds: 'new-demonstration-grain-bed' },
        { kind: 'rill', points: s.overflow.map(p => ({ ...p })), downhill: true, feeds: 'tailrace-canal' },
        { kind: 'canal', points: s.canal.map(p => ({ ...p })), downhill: true, feeds: 'village-paddy-low' },
      );
    } else {
      layout.conduits.push({ points: s.run.map(p => ({ ...p })), downhill: true, feeds: 'new-demonstration-grain-bed' });
    }

    const yaw = Math.atan2(-s.flow.z, s.flow.x), sign = s.side === -1 ? 1 : -1; // local Z is the right-hand bank normal
    const rot = builder(), support = builder(), motion = builder();
    for (const z of [-0.46, 0.46]) {
      ring(rot, 0, 0, z, 1.26, 0.08, C.wood);
      ring(rot, 0, 0, z, 1.38, 0.052, C.cut);
      for (let j = 0; j < 12; j++) {
        const a = j * TAU / 12;
        rod(rot, [0, 0, z], [Math.cos(a) * 1.26, Math.sin(a) * 1.26, z], 0.048, j % 2 ? C.cut : C.wood);
      }
    }
    rod(rot, [0, 0, -0.82], [0, 0, sign * (s.axleLength + 0.2)], 0.14, C.dark, 8);
    for (let j = 0; j < 12; j++) {
      const a = j * TAU / 12, x = Math.cos(a) * 1.33, y = Math.sin(a) * 1.33;
      box(rot, x, y, 0, 0.26, 0.1, 0.98, C.wood, a);
      const bucket = new THREE.LatheGeometry([[0, 0], [0.12, 0], [0.17, 0.26], [0.13, 0.26], [0.085, 0.055], [0, 0.055]].map(p => new THREE.Vector2(...p)), 6);
      rot.add(bucket, C.cut, matrix(Math.cos(a) * 1.16, Math.sin(a) * 1.16, 0.52, 0, 0, a - Math.PI / 2));
    }
    // Single eccentric cam fixed to the same axle; no independent animation clock.
    rot.add(new THREE.CylinderGeometry(0.46, 0.46, 0.3, 64), C.cut, matrix(0.19, 0, sign * s.axleLength, Math.PI / 2));
    wheel = rot.mesh('waterworks-wheel-and-cam');
    wheel.userData.dynamic = true;
    const assembly = new THREE.Group();
    assembly.position.set(s.x, s.y, s.z);
    assembly.rotation.y = yaw;
    assembly.add(wheel);
    group.add(assembly);

    for (const dist of [-0.86, s.axleLength]) {
      const z = sign * dist;
      for (const dx of [-0.64, 0.64]) {
        const p = worldPoint(s, dx, 0, dist), floor = habitatSurface(options.field, p.x, p.z);
        rod(support, [dx, floor - s.y - 0.04, z], [dx, floor - s.y + 0.18, z], 0.17, C.stone, 6);
        rod(support, [dx, floor - s.y + 0.12, z], [dx, 0.16, z], 0.11, C.wood);
        addBlock(p.x, p.z, 0.18, 0.18, 0, floor, s.y + 0.18);
      }
      rod(support, [-0.78, 0.16, z], [0.78, 0.16, z], 0.13, C.dark);
      rod(support, [-0.64, -0.68, z], [0.64, 0.14, z], 0.058, C.cut);
    }
    const frame = support.mesh('waterworks-axle-frames');
    assembly.add(frame);

    // Bank mortar with stepped stone plinth, pivoted beam and carved wooden pestle hammer head (tip strictly at y=-1.18).
    const m = s.mortar;
    staticB.add(new THREE.CylinderGeometry(0.64, 0.72, 0.14, 10), C.stone, matrix(m.x, m.y + 0.06, m.z));
    vessel(staticB, m.x, m.y + 0.02, m.z, 0.6, 0.72, C.stone);
    addBlock(m.x, m.z, 0.61, 0.61, 0, m.y + 0.02, m.y + 0.74);
    mark('water-mortar', { x: m.x + s.axis.x * 0.58, y: m.y + 0.75, z: m.z + s.axis.z * 0.58 });
    const grainB = builder();
    grainB.add(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 12), C.grain, matrix(m.x, m.y + 0.46, m.z));
    group.add(grainB.mesh('waterworks-mortar-grain'));

    const leverRoot = worldPoint(s, -0.8, m.y + 1.68, s.axleLength);
    s.followerDepth = leverRoot.y - s.y - 0.27;
    addBlock(s.x, s.z, 1.72, 0.78, yaw, s.y - 1.6, s.y + 1.6);
    const beam = worldPoint(s, 1.5, 0, s.axleLength);
    addBlock(beam.x, beam.z, 2.4, 0.22, yaw, m.y + 0.5, leverRoot.y + 2.7);
    box(motion, 1.45, 0, 0, 3.1, 0.19, 0.22, C.wood);
    box(motion, 3, 0, 0, 0.32, 0.26, 0.28, C.dark);
    rod(motion, [3, 0, 0], [3, -0.96, 0], 0.085, C.cut);
    rod(motion, [3, -0.94, 0], [3, -1.18, 0], 0.142, C.dark, 7);
    box(motion, -0.8, 0, 0, 0.26, 0.25, 0.25, C.dark);
    pestle = motion.mesh('waterworks-pestle');
    pestle.geometry.translate(0.8, 0, 0);
    const footB = builder();
    rod(footB, [0.8, 0, 0], [0.8, -s.followerDepth, 0], 0.035, C.dark, 6);
    const foot = footB.mesh('waterworks-cam-follower');
    const pivot = new THREE.Group();
    pivot.userData.dynamic = true;
    pivot.position.set(leverRoot.x, leverRoot.y, leverRoot.z);
    pivot.rotation.y = yaw;
    pivot.add(pestle, foot);
    group.add(pivot);
    pestle = pivot;
    pestle.rotation.z = leverAngle(0, s);
    for (const d of [-0.45, 0.45]) {
      const p = worldPoint(s, -0.8, 0, s.axleLength + d);
      rod(staticB, [p.x, habitatSurface(options.field, p.x, p.z), p.z], [p.x, leverRoot.y, p.z], 0.11, C.wood);
      addBlock(p.x, p.z, 0.16, 0.16, 0, habitatSurface(options.field, p.x, p.z), leverRoot.y);
    }

    // Mountain springhead boulders + elevated timber-trestle flume feeding the overshot foothill wheel & bamboo conduit.
    const sp0 = s.spring;
    for (let j = 0; j < 6; j++) {
      const ang = (j / 5) * Math.PI * 1.2 - Math.PI * 0.1;
      const rx = sp0.x + s.flow.x * Math.cos(ang) * 1.02 + s.axis.x * Math.sin(ang) * 1.06;
      const rz = sp0.z + s.flow.z * Math.cos(ang) * 1.02 + s.axis.z * Math.sin(ang) * 1.06;
      const g = stoneGeometry(617 + j * 31), p = g.attributes.position;
      g.rotateY(j * 0.85);
      g.computeBoundingBox();
      const lo = g.boundingBox.min.y, hi = g.boundingBox.max.y, topY = sp0.y + 0.44 + 0.16 * (j % 2);
      for (let i = 0; i < p.count; i++) {
        const px = rx + p.getX(i) * 0.48, pz = rz + p.getZ(i) * 0.48;
        const fl = habitatSurface(options.field, px, pz) - 0.04, u = (p.getY(i) - lo) / (hi - lo);
        p.setXYZ(i, px, fl + u * Math.max(0.42, topY - fl), pz);
      }
      staticB.add(g, j % 2 ? C.stone : '#899184');
    }
    wetB.add(new THREE.CylinderGeometry(0.72, 0.64, 0.12, 8), C.water, matrix(sp0.x, sp0.y - 0.04, sp0.z));
    addReserve(sp0.x, sp0.z, 1.55);
    addBlock(sp0.x + s.axis.x * 0.75, sp0.z + s.axis.z * 0.75, 1.05, 0.62, yaw, sp0.ground, sp0.y + 0.52);

    for (let i = 1; i < s.springRace.length; i++) {
      const a = s.springRace[i - 1], b = s.springRace[i], segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const segYaw = Math.atan2(-(b.z - a.z), b.x - a.x), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2;
      const nx = (b.z - a.z) / segLen, nz = -(b.x - a.x) / segLen;
      if (i <= 2) {
        staticB.add(new THREE.BoxGeometry(segLen + 0.16, 0.11, 0.56), C.wood, matrix(mx, my - 0.09, mz, 0, segYaw, 0));
        for (const side of [-1, 1]) openRod(staticB, [a.x + nx * side * 0.24, a.y + 0.03, a.z + nz * side * 0.24], [b.x + nx * side * 0.24, b.y + 0.03, b.z + nz * side * 0.24], 0.065, C.dark, 5);
        for (const f of [0.28, 0.76]) {
          const bx = a.x + (b.x - a.x) * f, bz = a.z + (b.z - a.z) * f, by = a.y + (b.y - a.y) * f - 0.14;
          for (const side of [-1, 1]) {
            const px = bx + nx * side * 0.26, pz = bz + nz * side * 0.26, pf = habitatSurface(options.field, px, pz) - 0.05;
            openRod(staticB, [px, pf, pz], [px, by, pz], 0.075, C.wood, 5);
          }
          openRod(staticB, [bx - nx * 0.34, by, bz - nz * 0.34], [bx + nx * 0.34, by, bz + nz * 0.34], 0.055, C.dark, 4);
          const midF = habitatSurface(options.field, bx, bz);
          if (by - midF > 0.75) openRod(staticB, [bx - nx * 0.25, midF + 0.25, bz - nz * 0.25], [bx + nx * 0.25, by - 0.15, bz + nz * 0.25], 0.038, C.cut, 4);
        }
      } else {
        pipe(staticB, a, b, 0.21);
        const fA = habitatSurface(options.field, a.x, a.z);
        openRod(staticB, [a.x, fA, a.z], [a.x, a.y - 0.16, a.z], 0.08, C.wood, 4);
        addBlock(a.x, a.z, 0.13, 0.13, 0, fA, a.y - 0.16);
      }
      openRod(wetB, [a.x, a.y + 0.02, a.z], [b.x, b.y + 0.02, b.z], 0.10, C.water, 4);
    }

    const spLip = s.springRace.at(-1);
    const fall = worldPoint(s, -1.04, s.y + 0.88, 0);
    const dropMid = worldPoint(s, -1.26, s.y - 0.15, 0);
    const basinHit = worldPoint(s, -1.35, s.basinY, 0);
    openRod(wetB, [spLip.x, spLip.y + 0.02, spLip.z], [fall.x, fall.y, fall.z], 0.10, C.foam, 4);
    openRod(wetB, [fall.x, fall.y, fall.z], [dropMid.x, dropMid.y, dropMid.z], 0.095, C.foam, 4);

    if (s.mode === 'farmland') {
      openRod(wetB, [dropMid.x, dropMid.y, dropMid.z], [basinHit.x, basinHit.y, basinHit.z], 0.09, C.foam, 4);
      foamRing(wetB, basinHit.x, s.basinY + 0.022, basinHit.z, 0.08, 0.30, C.foam, 8);
      buildCatchBasin(s, s.basinY);
      buildAqueductAndDrop(s, spLip);
      buildNurseryAndBranch(s);
      buildCanalAndCrossings(s);

      springWaterPath = [...s.springRace, fall, dropMid, basinHit];
      aqueductWaterPath = [spLip, ...s.aqueduct, { x: s.aqueduct.at(-1).x, y: s.hiPaddy.waterY, z: s.aqueduct.at(-1).z }];
      branchWaterPath = [...s.branch, { x: s.branch.at(-1).x, y: s.bed.y, z: s.branch.at(-1).z }];
      canalWaterPath = [...s.canal];
    } else {
      const dropEnd = worldPoint(s, -1.28, s.y - 0.28, 0);
      openRod(wetB, [dropMid.x, dropMid.y, dropMid.z], [dropEnd.x, dropEnd.y, dropEnd.z], 0.09, C.foam, 4);
      pipe(staticB, spLip, s.run[0], 0.16);
      openRod(wetB, [spLip.x, spLip.y + 0.02, spLip.z], [s.run[0].x, s.run[0].y + 0.02, s.run[0].z], 0.065, C.water, 4);
      for (const side of [-1, 1]) {
        const a = worldPoint(s, -1.8, 0, side * 0.66), b = worldPoint(s, 1.3, 0, side * 0.66);
        rod(staticB, [a.x, habitatSurface(options.field, a.x, a.z) + 0.1, a.z], [b.x, habitatSurface(options.field, b.x, b.z) + 0.1, b.z], 0.11, C.stone, 5);
      }
      for (let k = -2; k <= 1; k++) {
        const p0 = worldPoint(s, k * 0.72, 0, 0), p1 = worldPoint(s, (k + 1) * 0.72, 0, 0);
        rod(wetB, [p0.x, habitatSurface(options.field, p0.x, p0.z) + 0.04, p0.z], [p1.x, habitatSurface(options.field, p1.x, p1.z) + 0.04, p1.z], 0.22, C.water, 4);
      }
      for (let i = 1; i < s.run.length; i++) pipe(staticB, s.run[i - 1], s.run[i]);
      for (const p of s.run) {
        const f = habitatSurface(options.field, p.x, p.z);
        rod(staticB, [p.x, f, p.z], [p.x, p.y - 0.18, p.z], 0.085, C.bamboo);
        addBlock(p.x, p.z, 0.13, 0.13, 0, f, p.y - 0.18);
      }
      const bed = s.bed;
      for (let ix = -2; ix <= 2; ix++) {
        for (let iz = -3; iz <= 3; iz++) {
          const x = bed.x + ix * 0.37, z = bed.z + iz * 0.37, y = habitatSurface(options.field, x, z) + 0.035, ang = ix * 1.7 + iz * 2.3;
          box(staticB, x, y, z, 0.36, 0.07, 0.36, C.soil);
          rod(staticB, [x, y, z], [x + 0.04, y + 0.54, z], 0.015, C.leaf, 3);
          rod(staticB, [x + 0.04, y + 0.52, z], [x + 0.04 + Math.cos(ang) * 0.10, y + 0.70, z + Math.sin(ang) * 0.10], 0.030, C.grain, 4);
        }
      }
      const grainTip = { x: bed.x + 0.74 + 0.04, z: bed.z + 1.11 };
      mark('bamboo-irrigation', { ...grainTip, y: habitatSurface(options.field, grainTip.x - 0.04, grainTip.z) + 0.845 });
      addReserve(bed.x, bed.z, 1.65);
      for (let i = 1; i < s.run.length; i++) {
        const a = s.run[i - 1], b = s.run[i];
        rod(wetB, [a.x, a.y + 0.02, a.z], [b.x, b.y + 0.02, b.z], 0.055, C.water, 4);
      }
      const outlet = s.run.at(-1);
      rod(wetB, [outlet.x, outlet.y, outlet.z], [outlet.x, bed.y - 0.2, outlet.z], 0.055, C.foam, 4);
      springWaterPath = [...s.springRace, fall, dropEnd];
      aqueductWaterPath = [...s.run, { x: outlet.x, y: bed.y - 0.2, z: outlet.z }];
      branchWaterPath = aqueductWaterPath;
      canalWaterPath = aqueductWaterPath;
    }

    mark('waterwheel', worldPoint(s, 0, s.y + 0.16, s.axleLength + 0.2), 5);
    addReserve(s.x, s.z, 2.3);
    addReserve(s.bank.x, s.bank.z, 1.6);
    addReserve(m.x, m.z, 1.6);
    for (const segs of [s.springRace, ...(s.mode === 'farmland' ? [s.aqueduct.slice(0, 4), s.branch, s.overflow, s.canal.slice(0, 5)] : [s.run])]) {
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1], b = segs[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.65);
        for (let k = 0; k <= n; k++) addReserve(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, 0.5);
      }
    }
    for (const p of [spLip, fall, dropMid]) addReserve(p.x, p.z, 0.45);

    const dropG = new THREE.OctahedronGeometry(0.075, 0);
    const dropM = new THREE.MeshLambertMaterial({ color: C.foam, flatShading: true });
    const dropBox = new THREE.Box3(), dropV = new THREE.Vector3();
    for (const path of [springWaterPath, aqueductWaterPath, branchWaterPath, canalWaterPath]) {
      for (const p of path) dropBox.expandByPoint(dropV.set(p.x, p.y, p.z));
    }
    dropBox.expandByScalar(1);
    const beadCount = 30;
    drops = new THREE.InstancedMesh(dropG, dropM, beadCount);
    drops.name = 'waterworks-flow-beads';
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    drops.boundingSphere = dropBox.getBoundingSphere(new THREE.Sphere());
    drops.frustumCulled = true;
    group.add(drops);
    for (let i = 0; i < beadCount; i++) {
      const p = i < 6 ? springWaterPath[0] : i < 16 ? aqueductWaterPath[0] : i < 20 ? branchWaterPath[0] : canalWaterPath[0];
      drops.setMatrixAt(i, matrix(p.x, p.y, p.z));
    }

    // Search another genuinely wet reach, then publish only a dry shore working prop.
    const ropePoints = (trap, bank, yawTrap) => {
      const end = { x: bank.x + Math.sin(yawTrap) * 0.65, z: bank.z + Math.cos(yawTrap) * 0.65, y: bank.y + 0.65 };
      const start = { x: trap.x, z: trap.z, y: trap.y + 0.3 };
      const n = Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 0.4);
      return Array.from({ length: n + 1 }, (_, i) => {
        const u = i / n, x = start.x + (end.x - start.x) * u, z = start.z + (end.z - start.z) * u;
        return { x, z, y: Math.max(start.y + (end.y - start.y) * u - Math.sin(u * Math.PI) * 0.2, habitatSurface(options.field, x, z) + 0.15) };
      });
    };
    let trapSite = null;
    for (const t of [0.79, 0.78, 0.77, 0.75, 0.73, 0.71, 0.69]) {
      const p = options.riverCurve.getPointAt(t), v = options.riverCurve.getTangentAt(t);
      for (const side of [-1, 1]) {
        const nx = v.z * side, nz = -v.x * side, tx = p.x + nx * 4, tz = p.z + nz * 4;
        if (!clear(context, tx, tz, 3.7) || Math.hypot(tx - s.x, tz - s.z) < 11 || habitatSurface(options.field, tx, tz) > options.world.terrain.waterLevel - 0.55) continue;
        for (let a = 9; a < 21; a++) {
          const x = p.x + nx * a, z = p.z + nz * a;
          if (habitatSiteSafe(x, z, 1.8, context) && Math.hypot(x - s.bank.x, z - s.bank.z) > 7 && ropePoints({ x: tx, z: tz, y: options.world.terrain.waterLevel + 0.05 }, { x, z, y: habitatSurface(options.field, x, z) }, Math.atan2(-nx, -nz)).every(q => clear(context, q.x, q.z, 0.15))) {
            trapSite = { x: tx, z: tz, y: options.world.terrain.waterLevel + 0.05, flow: { x: v.x, z: v.z }, bank: { x, z, y: habitatSurface(options.field, x, z) }, yaw: Math.atan2(-nx, -nz) };
            break;
          }
        }
        if (trapSite) break;
      }
      if (trapSite) break;
    }
    if (trapSite) {
      const t = trapSite, trapB = builder(), trapG = new THREE.Group();
      trapG.userData.dynamic = true;
      trapG.position.set(t.x, t.y, t.z);
      trapG.rotation.y = Math.atan2(t.flow.x, t.flow.z);
      trapShape(trapB, 0, -0.08, 0);
      const trap = trapB.mesh('waterworks-woven-fish-trap');
      trapG.add(trap);
      group.add(trapG);

      // Genuine irregular riverstone courses, bed-conforming and low at the waterline.
      // Widen the tips for stone thickness: the entire downstream throat remains open.
      const stones = builder();
      t.weirStones = [];
      for (const side of [-1, 1]) {
        const a = { x: t.x - t.flow.x * 2.8 + t.flow.z * side * 1.9, z: t.z - t.flow.z * 2.8 - t.flow.x * side * 1.9 };
        const b = { x: t.x + t.flow.z * side * 0.82, z: t.z - t.flow.x * side * 0.82 };
        for (let j = 0; j <= 10; j++) {
          const f = j / 10, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, y = habitatSurface(options.field, x, z);
          const top = options.world.terrain.waterLevel + 0.12 + 0.025 * Math.sin(j * 1.7 + side);
          rod(staticB, [x, y, z], [x, t.y + 0.2, z], 0.06, C.bamboo, 4);
          addReserve(x, z, 0.28);
          addBlock(x, z, 0.25, 0.25, 0, y - 0.03, Math.max(top, t.y + 0.2));
          for (let k = 0; k < 3; k++) {
            const g = stoneGeometry(431 + j * 37 + k * 13 + (side + 1) * 61), p = g.attributes.position;
            g.rotateY(j * 0.87 + k * 0.44);
            g.computeBoundingBox();
            const lo = g.boundingBox.min.y, hi = g.boundingBox.max.y;
            for (let i = 0; i < p.count; i++) {
              const px = x + p.getX(i) * 0.53, pz = z + p.getZ(i) * 0.51, floor = habitatSurface(options.field, px, pz);
              const h = (top - floor) / 3, u = (p.getY(i) - lo) / (hi - lo);
              p.setXYZ(i, px, floor + k * h + u * h - 0.025 * (1 - u), pz);
            }
            stones.add(g, j % 3 === 0 ? '#899184' : j % 3 === 1 ? '#A0A391' : C.stone);
            t.weirStones.push({ x, z, radius: 0.27, course: k, top });
          }
        }
        rod(staticB, [a.x, t.y + 0.08, a.z], [b.x, t.y + 0.08, b.z], 0.055, C.dark);
      }
      group.add(stones.mesh('waterworks-stone-v-weir'));
      const b = t.bank, station = { kind: 'trap', x: b.x, y: b.y, z: b.z, yaw: t.yaw };
      const propB = builder();
      trapShape(propB, 0, 0.72, 0.83);
      const prop = propB.mesh('waterworks-shore-trap-prop');
      prop.geometry.scale(0.6, 0.6, 0.6);
      prop.position.set(b.x, b.y, b.z);
      prop.rotation.y = t.yaw;
      prop.userData.dynamic = true;
      prop.userData.communityRole = 'trap';
      prop.userData.communityContact = { x: 0, y: 0.65, z: 0.65 };
      prop.userData.communityGrip = {
        left: { x: -Math.SQRT1_2 * 0.288, y: 0.432 + Math.SQRT1_2 * 0.288, z: 0.498 },
        right: { x: Math.SQRT1_2 * 0.288, y: 0.432 + Math.SQRT1_2 * 0.288, z: 0.498 },
      };
      group.add(prop);
      station.prop = prop;
      station.handling = 'linked-shore-basket-and-haul-line';
      stations.push(station);
      const haulLine = ropePoints(t, b, t.yaw);
      for (let j = 1; j < haulLine.length; j++) {
        const a = haulLine[j - 1], c = haulLine[j];
        rod(staticB, [a.x, a.y, a.z], [c.x, c.y, c.z], 0.022, C.cut, 4);
        addReserve(c.x, c.z, 0.18);
      }
      for (let j = 0; j < 3; j++) ring(staticB, b.x - 0.4, b.y + 0.07 + j * 0.028, b.z, 0.24 + j * 0.02, 0.018, C.cut, Math.PI / 2);
      t.haulLine = haulLine;
      layout.traps.push({ ...t, throatWidth: 1.04, coneMouth: 0.48, coneThroat: 0.09 });
      mark('fish-trap', { x: b.x + Math.sin(t.yaw) * 0.498, y: b.y + 0.73, z: b.z + Math.cos(t.yaw) * 0.498 }, 3.5);
      addReserve(t.x, t.z, 3.7);
      addReserve(b.x, b.z, 1.8);
      addBlock(b.x + Math.sin(t.yaw) * 0.99, b.z + Math.cos(t.yaw) * 0.99, 0.32, 0.52, t.yaw, b.y + 0.14, b.y + 0.72);
    } else {
      layout.rejected.push('no-clear-dry-trap-station');
    }
  };

  if (cfg.enabled !== false && complete) build();
  const solid = staticB.mesh('waterworks-static');
  if (solid) group.add(solid);
  waterMesh = wetB.mesh('waterworks-water');
  if (waterMesh) group.add(waterMesh);

  let triangles = 0, drawCalls = 0;
  group.traverse(o => {
    if (o.isMesh) {
      triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      drawCalls++;
    }
  });
  if (triangles > Math.min(11000, cfg.maxTriangles)) {
    group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    group.clear();
    targets.length = 0;
    blockers.length = 0;
    stations.length = 0;
    for (const k of ['wheels', 'traps', 'beds', 'conduits', 'springs', 'springRaces', 'reservations']) layout[k] = [];
    layout.rejected.push('triangle-budget');
    triangles = 0;
    drawCalls = 0;
    wheel = null;
    pestle = null;
    waterMesh = null;
    drops = null;
  }

  return {
    group,
    blockers,
    targets,
    stations,
    layout,
    get wheelPhase() { return phase; },
    setSound(value) { sound = value; },
    update(dt, elapsed, sky) {
      if (disposed || !Number.isFinite(dt) || dt <= 0 || !wheel) return;
      const step = Math.min(dt, 0.1), old = phase, nextImpact = (impacts + 0.75) * TAU, hitImpact = old + step * 0.38 >= nextImpact;
      phase = hitImpact ? nextImpact : old + step * 0.38;
      wheel.rotation.z = phase % TAU;
      if (drops) {
        const placeBead = (idx, path, slot, totalSlots) => {
          if (!path || path.length < 2) return;
          const f = ((phase * 0.8 + slot / totalSlots) * (path.length - 1)) % (path.length - 1);
          const j = Math.floor(f), a = path[j], b = path[j + 1], u = f - j;
          drops.setMatrixAt(idx, dropMatrix.makeTranslation(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + 0.025, a.z + (b.z - a.z) * u));
        };
        for (let i = 0; i < 6; i++) placeBead(i, springWaterPath, i, 6);
        for (let i = 0; i < 10; i++) placeBead(6 + i, aqueductWaterPath, i, 10);
        for (let i = 0; i < 4; i++) placeBead(16 + i, branchWaterPath, i, 4);
        for (let i = 0; i < 10; i++) placeBead(20 + i, canalWaterPath, i, 10);
        drops.instanceMatrix.needsUpdate = true;
      }
      if (pestle) pestle.rotation.z = leverAngle(phase, layout.wheels[0]);
      if (hitImpact) {
        impacts++;
        const m = layout.wheels[0].mortar;
        const master = sound?.getStats?.().master;
        if (sound?.ready && !sound.muted && master !== 0 && Number.isFinite(m.x) && Number.isFinite(m.z) && typeof sound.wood === 'function') {
          sound.wood(m.x, m.z);
          played++;
        }
      }
    },
    getStats: () => ({
      triangles,
      drawCalls,
      wheels: layout.wheels.length,
      traps: layout.traps.length,
      targets: targets.length,
      stations: stations.length,
      phase,
      impacts,
      played,
      disabled: cfg.enabled === false,
      degraded: !complete,
      disposed,
      rejected: [...layout.rejected],
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      group.clear();
      sound = null;
    },
  };
}
