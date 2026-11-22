import * as THREE from 'three';
import { roughRockGeometry } from './rock.js';
import { sampleBankPatch } from './riverbank.js';
import { chainProgramCacheKey } from '../systems/shader-cache-key.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 弧叶柔草：每片叶由 3 段（入土窄根鞘 → 下段叶鞘 → 宽拱叶腰 → 垂弯叶尖，共 5 枚三角面）拼成喷泉弧线，
// 根部带温润腐殖暗影，向叶尖渐变为透亮新绿，告别僵硬双三角纸刺感。
function tuftGeometry(blades, seed, shape) {
  const rnd = mulberry32(seed);
  const pos = [];
  const col = [];
  const tips = [];
  const wR = shape.width;
  const hR = shape.height;
  const lR = shape.lean;
  const shR = shape.shade;
  const cRoot = (shape.base ?? 0.5) * 0.80;
  const cWaist = shape.waist ?? 0.85;
  const cSheath = cRoot + (cWaist - cRoot) * 0.50;
  const cTip = (shape.tip ?? 1.0) * 1.04;

  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = hR[0] + rnd() * (hR[1] - hR[0]);
    const wb = wR[0] + rnd() * (wR[1] - wR[0]);
    const lean = lR[0] + rnd() * (lR[1] - lR[0]);
    const bend = shape.bend * (0.6 + rnd() * 0.8);
    const ao = rnd() * Math.PI * 2;
    const ar = Math.sqrt(rnd()) * shape.rootRadius;
    const ox = Math.cos(ao) * ar;
    const oz = Math.sin(ao) * ar;
    const shade = shR[0] + rnd() * (shR[1] - shR[0]);

    // (s 侧向, f 前倾, y 高度, c 明度, u 根→尖渐变)
    const put = (s, f, y, c, u) => {
      pos.push(-sa * s + ca * f + ox, y, ca * s + sa * f + oz);
      const v = c * shade;
      const rTone = 1.02 - 0.02 * u;
      const gTone = 0.96 + 0.035 * u;
      const bTone = 0.82 + 0.10 * u;
      col.push(v * rTone, v * gTone, v * bTone);
      tips.push(u === 1 ? 1 : 0);
    };

    const rl = [-wb * 0.26, 0, -0.015];
    const rr = [wb * 0.26, 0, -0.015];
    const sl = [-wb * 0.78, lean * 0.23, h * 0.35];
    const sr = [wb * 0.78, lean * 0.25, h * 0.35];
    const wl = [-wb, lean * 0.60 + bend * 0.32, h * 0.69];
    const wr = [wb, lean * 0.64 + bend * 0.32, h * 0.69];
    const tip = [0, lean + bend, h * (0.94 - Math.min(0.14, bend * 0.22))];

    // 第 1 段（2 三角）：入土根鞘 → 下段叶鞘
    put(rl[0], rl[1], rl[2], cRoot, 0.0);
    put(rr[0], rr[1], rr[2], cRoot, 0.0);
    put(sr[0], sr[1], sr[2], cSheath, 0.34);
    put(rl[0], rl[1], rl[2], cRoot, 0.0);
    put(sr[0], sr[1], sr[2], cSheath, 0.34);
    put(sl[0], sl[1], sl[2], cSheath, 0.34);

    // 第 2 段（2 三角）：下段叶鞘 → 宽拱叶腰
    put(sl[0], sl[1], sl[2], cSheath, 0.34);
    put(sr[0], sr[1], sr[2], cSheath, 0.34);
    put(wr[0], wr[1], wr[2], cWaist, 0.68);
    put(sl[0], sl[1], sl[2], cSheath, 0.34);
    put(wr[0], wr[1], wr[2], cWaist, 0.68);
    put(wl[0], wl[1], wl[2], cWaist, 0.68);

    // 第 3 段（1 三角）：宽拱叶腰 → 垂弯收尖
    put(wl[0], wl[1], wl[2], cWaist, 0.68);
    put(wr[0], wr[1], wr[2], cWaist, 0.68);
    put(tip[0], tip[1], tip[2], cTip, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tips, 1));
  g.computeVertexNormals();
  return g;
}

// 花：细茎 + 两片交叉的小瓣
function flowerGeometry(kind, seed) {
  const rnd = mulberry32(seed);
  const pos = [];
  if (kind === 'stem') {
    const w = 0.016;
    const lean = (rnd() - 0.5) * 0.18;
    const h = 0.86 + rnd() * 0.2;
    const v = [[-w, 0], [w, 0], [w * 0.7 + lean, h], [-w * 0.7 + lean, h]];
    const idx = [0, 1, 2, 0, 2, 3];
    for (let k = 0; k < idx.length; k++) {
      const p = v[idx[k]];
      pos.push(p[0], p[1], 0);
    }
  } else {
    const w = 0.085;
    const y0 = 0.93;
    // 两片交叉的竖直花瓣
    const quads = [
      [[-w, y0 - w, 0], [w, y0 - w, 0], [w, y0 + w, 0], [-w, y0 + w, 0]],
      [[0, y0 - w, -w], [0, y0 - w, w], [0, y0 + w, w], [0, y0 + w, -w]]
    ];
    for (let q = 0; q < 2; q++) {
      const v = quads[q];
      const idx = [0, 1, 2, 0, 2, 3];
      for (let k = 0; k < idx.length; k++) {
        const p = v[idx[k]];
        pos.push(p[0], p[1], p[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// 草簇、野花与碎石：填住脚下的空地，是「芳草鲜美」最省的一笔
export function createScatter(cfg, field, reject, road, approach, shore) {
  const rand = mulberry32(60123);
  const group = new THREE.Group();
  group.name = 'scatter';
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const hasColorAt = typeof field?.colorAt === 'function';
  const ok = function (x, z, kind) {
    return !(reject && reject(x, z, kind));
  };

  // ---- 沿路取样：近景草与野花贴着主路和屋前长 ----
  const segs = [];
  let roadLen = 0;
  if (road && road.points && road.points.length > 1) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      segs.push({ ax: a[0], az: a[1], dx: dx / L, dz: dz / L, L: L, s0: roadLen });
      roadLen += L;
    }
  }
  function alongRoad(spread, sideBias) {
    if (!segs.length) return null;
    let s = rand() * roadLen;
    let sg = segs[0];
    for (let i = 0; i < segs.length; i++) {
      if (s >= segs[i].s0 && s <= segs[i].s0 + segs[i].L) {
        sg = segs[i];
        break;
      }
    }
    const t = s - sg.s0;
    const px = sg.ax + sg.dx * t;
    const pz = sg.az + sg.dz * t;
    const side = sideBias || (rand() < 0.5 ? -1 : 1);
    const off = 0.55 + Math.sqrt(rand()) * spread;
    return { x: px - sg.dz * off * side, z: pz + sg.dx * off * side };
  }

  const tuftCfg = cfg.tuft;

  // ---- 0. 坡脚水墨苔痕润泽带：顺等高线皴擦拉长、中心柔融地色，彻底告别圆饼碎贴感 ----
  const patchCfg = cfg.patch;
  if (patchCfg && patchCfg.count > 0) {
    const patchBrushRand = mulberry32(60129);
    const pa = patchCfg.area || tuftCfg.area;
    const base = new THREE.Color(patchCfg.base || '#8FB055');
    const c0 = new THREE.Color(patchCfg.color);
    const c1 = new THREE.Color(patchCfg.color2);
    const centerMix = new THREE.Color();
    const pPos = [];
    const pCol = [];
    const n2 = 7;
    let made = 0;
    let g0 = 0;
    while (made < patchCfg.count && g0 < patchCfg.count * 25) {
      g0++;
      const x = pa[0] + rand() * (pa[2] - pa[0]);
      const z = pa[1] + rand() * (pa[3] - pa[1]);
      if (!ok(x, z, 'patch')) continue;
      made++;
      const r = patchCfg.scale[0] + rand() * (patchCfg.scale[1] - patchCfg.scale[0]);
      const rot = rand() * Math.PI * 2;
      const tone = c0.clone().lerp(c1, rand());
      const edge = tone.clone().lerp(base, 0.55);
      const rr = [];
      for (let k = 0; k < n2; k++) rr.push(r * (0.6 + rand() * 0.55));

      // 顺应地形等高线切向或平畴微风流向拉长成披麻水墨带（不额外消耗主 rand 序列）
      const gx = field.sample(x + 1.6, z) - field.sample(x - 1.6);
      const gz = field.sample(x, z + 1.6) - field.sample(x, z - 1.6);
      const gLen = Math.hypot(gx, gz);
      const flowAng = gLen > 0.05
        ? Math.atan2(gx, -gz) + (patchBrushRand() - 0.5) * 0.42
        : Math.sin(x * 0.024 + z * 0.019) * 1.15 + (patchBrushRand() - 0.5) * 0.68;
      const stretchAlong = 2.15 + patchBrushRand() * 0.85;
      const stretchAcross = 0.46 + patchBrushRand() * 0.22;
      const curveArch = (patchBrushRand() - 0.5) * 0.34 * r;
      const cf = Math.cos(flowAng);
      const sf = Math.sin(flowAng);

      if (hasColorAt) {
        centerMix.copy(field.colorAt(x, z)).lerp(tone, 0.36);
      } else {
        centerMix.copy(tone);
      }

      const ringPts = [];
      for (let k = 0; k < n2; k++) {
        const a = rot + (k / n2) * Math.PI * 2;
        const u = Math.cos(a) * rr[k] * stretchAlong;
        const uNorm = u / Math.max(0.1, r * stretchAlong);
        const v = Math.sin(a) * rr[k] * stretchAcross + curveArch * (1 - uNorm * uNorm);
        const wx = x + u * cf - v * sf;
        const wz = z + u * sf + v * cf;
        ringPts.push([wx, wz]);
      }

      for (let k = 0; k < n2; k++) {
        const p0 = ringPts[k];
        const p1 = ringPts[(k + 1) % n2];
        const x0 = p0[0], z0 = p0[1];
        const x1 = p1[0], z1 = p1[1];
        pPos.push(x, field.sample(x, z) + 0.022, z);
        pPos.push(x0, field.sample(x0, z0) + 0.022, z0);
        pPos.push(x1, field.sample(x1, z1) + 0.022, z1);
        const ec0 = hasColorAt ? field.colorAt(x0, z0) : edge;
        const ec1 = hasColorAt ? field.colorAt(x1, z1) : edge;
        pCol.push(centerMix.r, centerMix.g, centerMix.b);
        pCol.push(ec0.r, ec0.g, ec0.b);
        pCol.push(ec1.r, ec1.g, ec1.b);
      }
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    pg.setAttribute('color', new THREE.Float32BufferAttribute(pCol, 3));
    pg.computeVertexNormals();
    const pm = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }));
    pm.name = 'ground-patch';
    group.add(pm);
  }

  // ---- 1. 远草：成簇撒，密处密、疏处疏，比均匀撒更像草地 ----
  const area = tuftCfg.area;
  const baseShape = tuftCfg.shape;
  const tuftGeo = tuftGeometry(tuftCfg.blades, 3311, baseShape);
  const tuftMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const cA = new THREE.Color(tuftCfg.color);
  const cB = new THREE.Color(tuftCfg.color2);
  const spots = [];
  const cl = tuftCfg.cluster || [4, 8];
  const clR = tuftCfg.clusterRadius || 1.5;
  let guard = 0;
  while (spots.length < tuftCfg.count && guard < tuftCfg.count * 40) {
    guard++;
    const cx = area[0] + rand() * (area[2] - area[0]);
    const cz = area[1] + rand() * (area[3] - area[1]);
    if (!ok(cx, cz, 'tuft')) continue;
    const n = cl[0] + Math.floor(rand() * (cl[1] - cl[0] + 1));
    for (let i = 0; i < n && spots.length < tuftCfg.count; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * clR;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (!ok(x, z, 'tuft')) continue;
      spots.push({ x: x, z: z, s: tuftCfg.scale[0] + rand() * (tuftCfg.scale[1] - tuftCfg.scale[0]) });
    }
  }
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, spots.length);
  tuftMesh.name = 'grass';
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    dummy.position.set(s.x, field.sample(s.x, s.z) - 0.04, s.z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(s.s, s.s * (0.78 + rand() * 0.5), s.s);
    dummy.updateMatrix();
    tuftMesh.setMatrixAt(i, dummy.matrix);
    col.copy(cA).lerp(cB, rand() * rand());
    if (hasColorAt) {
      const gc = field.colorAt(s.x, s.z);
      if (gc) col.lerp(gc, 0.26);
    }
    tuftMesh.setColorAt(i, col);
  }
  tuftMesh.instanceMatrix.needsUpdate = true;
  if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true;
  tuftMesh.computeBoundingSphere();
  group.add(tuftMesh);

  // ---- 2. 近草：只长在路两侧和屋前，草叶更细更密，凑近才看得出蓬松 ----
  const nearCfg = cfg.near;
  if (nearCfg && segs.length) {
    const nGeo = tuftGeometry(nearCfg.blades, 7711, Object.assign({}, baseShape, nearCfg.shape));
    const nMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const flowerUniforms = {
      uFlowerA: { value: new THREE.Color('#F7F2E2') },
      uFlowerB: { value: new THREE.Color('#E9C46A') },
      uFlowerAmt: { value: 0.9 }
    };
    nMat.userData.flowerUniforms = flowerUniforms;
    // 草尖花点：约一成八草簇在尖上开白/黄小花，逐实例哈希决定，零新增实例与 draw
    nMat.onBeforeCompile = function (shader) {
      shader.uniforms.uFlowerA = flowerUniforms.uFlowerA;
      shader.uniforms.uFlowerB = flowerUniforms.uFlowerB;
      shader.uniforms.uFlowerAmt = flowerUniforms.uFlowerAmt;
      shader.vertexShader = 'attribute float aTip;\nuniform vec3 uFlowerA;\nuniform vec3 uFlowerB;\nvarying float vTip;\nvarying vec3 vFlower;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float fh = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);\n' +
        'vTip = aTip * step(0.82, fh);\n' +
        'vFlower = fh < 0.91 ? uFlowerA : uFlowerB;'
      );
      shader.fragmentShader = 'uniform float uFlowerAmt;\nvarying float vTip;\nvarying vec3 vFlower;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vFlower, vTip * uFlowerAmt);'
      );
    };
    chainProgramCacheKey(nMat, 'scatter-near-flower-v1');
    const nA = new THREE.Color(nearCfg.color);
    const nB = new THREE.Color(nearCfg.color2);
    const ns = [];
    guard = 0;
    while (ns.length < nearCfg.count && guard < nearCfg.count * 40) {
      guard++;
      const p = alongRoad(nearCfg.spread || 9);
      if (!p || !ok(p.x, p.z, 'near')) continue;
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n && ns.length < nearCfg.count; i++) {
        const x = p.x + (rand() - 0.5) * 1.1;
        const z = p.z + (rand() - 0.5) * 1.1;
        if (!ok(x, z, 'near')) continue;
        ns.push({ x: x, z: z, s: nearCfg.scale[0] + rand() * (nearCfg.scale[1] - nearCfg.scale[0]) });
      }
    }
    const nm = new THREE.InstancedMesh(nGeo, nMat, ns.length);
    nm.name = 'grass-near';
    for (let i = 0; i < ns.length; i++) {
      const s = ns[i];
      dummy.position.set(s.x, field.sample(s.x, s.z) - 0.02, s.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s.s, s.s * (0.8 + rand() * 0.5), s.s);
      dummy.updateMatrix();
      nm.setMatrixAt(i, dummy.matrix);
      col.copy(nA).lerp(nB, rand() * rand());
      if (hasColorAt) {
        const gc = field.colorAt(s.x, s.z);
        if (gc) col.lerp(gc, 0.26);
      }
      nm.setColorAt(i, col);
    }
    nm.instanceMatrix.needsUpdate = true;
    if (nm.instanceColor) nm.instanceColor.needsUpdate = true;
    nm.computeBoundingSphere();
    group.add(nm);
  }

  // ---- 2b. 洞口外那条走廊：出生点到洞口，是玩的第一段路，不能秃 ----
  const apCfg = cfg.approach;
  if (apCfg && apCfg.count > 0 && approach) {
    const aGeo = tuftGeometry(apCfg.blades, 5511, Object.assign({}, baseShape, apCfg.shape));
    const aMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const aA = new THREE.Color(apCfg.color || tuftCfg.color);
    const aB = new THREE.Color(apCfg.color2 || tuftCfg.color2);
    const as = [];
    let g3 = 0;
    while (as.length < apCfg.count && g3 < apCfg.count * 30) {
      g3++;
      const u = rand();
      const side = rand() < 0.5 ? -1 : 1;
      const off = 0.7 + Math.pow(rand(), 0.75) * apCfg.spread;
      const x = approach.x + approach.dx * (u * approach.len) - approach.dz * off * side;
      const z = approach.z + approach.dz * (u * approach.len) + approach.dx * off * side;
      if (!ok(x, z, 'near')) continue;
      as.push({ x: x, z: z, s: apCfg.scale[0] + rand() * (apCfg.scale[1] - apCfg.scale[0]) });
    }
    const am = new THREE.InstancedMesh(aGeo, aMat, as.length);
    am.name = 'grass-approach';
    for (let i = 0; i < as.length; i++) {
      const s = as[i];
      dummy.position.set(s.x, field.sample(s.x, s.z) - 0.02, s.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s.s, s.s * (0.8 + rand() * 0.5), s.s);
      dummy.updateMatrix();
      am.setMatrixAt(i, dummy.matrix);
      col.copy(aA).lerp(aB, rand() * rand());
      if (hasColorAt) {
        const gc = field.colorAt(s.x, s.z);
        if (gc) col.lerp(gc, 0.26);
      }
      am.setColorAt(i, col);
    }
    am.instanceMatrix.needsUpdate = true;
    if (am.instanceColor) am.instanceColor.needsUpdate = true;
    am.computeBoundingSphere();
    group.add(am);
  }

  // ---- 3. 野花：白色与淡黄的小点，成片开在路边 ----
  const fCfg = cfg.flower;
  if (fCfg && fCfg.count > 0 && segs.length) {
    const palette = fCfg.colors.map(function (c) { return new THREE.Color(c); });
    const stemGeo = flowerGeometry('stem', 991);
    const headGeo = flowerGeometry('head', 991);
    const stemMat = new THREE.MeshLambertMaterial({ color: fCfg.stem || '#6F8C46', side: THREE.DoubleSide });
    const headMat = new THREE.MeshLambertMaterial({ color: '#FFFFFF', side: THREE.DoubleSide });
    const fs = [];
    guard = 0;
    while (fs.length < fCfg.count && guard < fCfg.count * 40) {
      guard++;
      const p = alongRoad(fCfg.spread || 12);
      if (!p || !ok(p.x, p.z, 'flower')) continue;
      const n = 4 + Math.floor(rand() * 5);
      for (let i = 0; i < n && fs.length < fCfg.count; i++) {
        const x = p.x + (rand() - 0.5) * 1.8;
        const z = p.z + (rand() - 0.5) * 1.8;
        if (!ok(x, z, 'flower')) continue;
        fs.push({
          x: x, z: z,
          s: fCfg.scale[0] + rand() * (fCfg.scale[1] - fCfg.scale[0]),
          c: palette[Math.floor(rand() * palette.length)]
        });
      }
    }
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, fs.length);
    stems.name = 'flower-stems';
    const heads = new THREE.InstancedMesh(headGeo, headMat, fs.length);
    heads.name = 'flower-heads';
    for (let i = 0; i < fs.length; i++) {
      const s = fs[i];
      const y = field.sample(s.x, s.z) - 0.02;
      dummy.position.set(s.x, y, s.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s.s, s.s, s.s);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, s.c);
    }
    stems.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    stems.computeBoundingSphere();
    heads.computeBoundingSphere();
    group.add(stems);
    group.add(heads);
  }

  // ---- 4. 碎石 ----
  const stoneCfg = cfg.stone;
  if (stoneCfg && stoneCfg.count > 0) {
    const sgeo = roughRockGeometry(8123, 0, 0.34);
    const smat = new THREE.MeshLambertMaterial({ flatShading: true });
    const ss = [];
    guard = 0;
    const sa = stoneCfg.area;
    const shoreCount = shore?.curve && shore?.terrainCfg?.shoreline
      ? Math.min(stoneCfg.count, Math.max(0, stoneCfg.shoreCount || 0)) : 0;
    let placedShore = 0, shoreTries = 0;
    while (ss.length < stoneCfg.count && guard < stoneCfg.count * 20) {
      guard++;
      // A custom field may have no suitable shoal: fall back to ordinary stones, not an empty batch.
      const shingle = placedShore < shoreCount && shoreTries++ < shoreCount * 24;
      let x, z;
      if (shingle) {
        const patch = sampleBankPatch(shore.curve, rand, shore.terrainCfg.shoreline.patches);
        const off = 9 + rand() * 8;
        x = patch.x + patch.nx * off;
        z = patch.z + patch.nz * off;
        const h = field.sample(x, z), water = shore.terrainCfg.waterLevel;
        if (z <= shore.terrainCfg.shoreline.startZ || z >= shore.terrainCfg.shoreline.endZ || h < water - 0.12 || h > water + 1.15) continue;
      } else {
        x = sa[0] + rand() * (sa[2] - sa[0]);
        z = sa[1] + rand() * (sa[3] - sa[1]);
      }
      if (!ok(x, z, 'stone')) continue;
      ss.push({ x: x, z: z, r: 0.16 + rand() * 0.34, a: rand() * Math.PI, shingle });
      if (shingle) placedShore++;
    }
    const stones = new THREE.InstancedMesh(sgeo, smat, ss.length);
    stones.name = 'stones';
    const cS = new THREE.Color(stoneCfg.color);
    const cS2 = new THREE.Color(stoneCfg.color2);
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      dummy.position.set(s.x, field.sample(s.x, s.z) + s.r * 0.22, s.z);
      dummy.rotation.set(rand() * 0.6, s.a, rand() * 0.6);
      dummy.scale.set(s.r * (1.1 + rand() * 0.7), s.r * (s.shingle ? 0.28 + rand() * 0.16 : 0.5 + rand() * 0.4), s.r);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
      stones.setColorAt(i, col.copy(cS).lerp(cS2, rand()));
    }
    stones.instanceMatrix.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
    stones.computeBoundingSphere();
    group.add(stones);
  }

  return { group: group, count: spots.length };
}
