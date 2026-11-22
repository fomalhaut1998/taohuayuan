import * as THREE from 'three';
import { roughRockGeometry } from './rock.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 层理皴裂危峰山岩几何（320 面二十面体细分 + 峰峦收尖与偏锋主脊 + 斧劈竖棱与折带岩阶 + 青绿赭石竖向设色）
// 使用独立种子，绝不消费 createCliff 的布局随机数序列。
function createStratifiedCliffGeometry(seed, altitudeBias) {
  const rnd = mulberry32(seed);
  const raw = new THREE.IcosahedronGeometry(1, 2);
  const g = raw.index ? raw.toNonIndexed() : raw;
  const pos = g.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  const phaseA = rnd() * Math.PI * 2;
  const phaseB = rnd() * Math.PI * 2;
  const phaseC = rnd() * Math.PI * 2;
  const leanAng = rnd() * Math.PI * 2;
  const leanDirX = Math.cos(leanAng);
  const leanDirZ = Math.sin(leanAng);
  const vertCache = new Map();

  const cDeepMoss = new THREE.Color('#4B5F45');
  const cMossBase = new THREE.Color('#5C7254');
  const cOchreStone = new THREE.Color('#8F8B79');
  const cCoolCrevice = new THREE.Color('#74837C');
  const cGreenShoulder = new THREE.Color('#899F94');
  const cMistyPeak = new THREE.Color('#B2C2BA');
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i += 3) {
    const faceShade = 0.93 + rnd() * 0.13;
    for (let k = 0; k < 3; k++) {
      const idx = i + k;
      const ux = pos.getX(idx);
      const uy = pos.getY(idx);
      const uz = pos.getZ(idx);
      const key = Math.round(ux * 2048) + ':' + Math.round(uy * 2048) + ':' + Math.round(uz * 2048);
      let displaced = vertCache.get(key);
      if (!displaced) {
        const ang = Math.atan2(uz, ux);
        // 斧劈竖向山骨棱脊 + 折带层理岩阶，破除球感
        const fluteA = Math.abs(Math.cos(ang * 2.5 + phaseA)) * 2 - 1;
        const fluteB = Math.sin(ang * 4 - phaseB);
        const fluteC = Math.cos(ang * 7 + phaseC);
        const rib = 0.095 * fluteA + 0.058 * fluteB + 0.028 * fluteC;

        const rawStrata = Math.sin(uy * 9.2 + 0.62 * Math.sin(ang * 2 + phaseA));
        const strataStep = rawStrata + 0.28 * Math.sin(rawStrata * Math.PI);
        const ledge = 0.052 * strataStep;
        const crag = (rnd() - 0.5) * 0.11;

        // 向上收峰、向下舒展山脚，杜绝圆滚鹅卵石轮廓
        let profile = 1.0;
        if (uy > 0.06) {
          const tTop = (uy - 0.06) / 0.94;
          profile = 1.0 - 0.34 * Math.pow(tTop, 1.32);
        } else if (uy < -0.14) {
          const tFoot = Math.min(1, (-0.14 - uy) / 0.72);
          profile = 1.0 + 0.08 * tFoot;
        }

        let rad = (0.93 + rib + ledge + crag) * profile;
        const crownLift = uy > 0.2 ? Math.pow((uy - 0.2) / 0.8, 1.5) * 0.10 * (0.6 + 0.4 * fluteA) : 0;
        let py = uy * (0.96 + 0.05 * Math.cos(ang * 2 - phaseB)) + 0.026 * strataStep + crownLift;

        // 偏锋主脊微倾，使每座峰峦具主客揖让之势
        const apexShift = Math.max(0, uy + 0.25) * 0.11;
        let dx = ux * rad + leanDirX * apexShift;
        let dz = uz * rad + leanDirZ * apexShift;

        // 底部压平收稳，让山石扎进草坡而不是尖刺入土
        if (py < -0.56) {
          const t = Math.min(1, (-0.56 - py) / 0.44);
          py = -0.56 - (-0.56 - py) * 0.34;
          const flare = 1 + t * 0.06;
          dx *= flare;
          dz *= flare;
        }
        const horiz = Math.hypot(dx, dz);
        if (horiz > 1.08) {
          const s = 1.08 / horiz;
          dx *= s;
          dz *= s;
        }
        const sunAspect = 0.5 + 0.5 * (ux * 0.68 - uz * 0.45);
        displaced = [dx, py, dz, strataStep, fluteA, sunAspect];
        vertCache.set(key, displaced);
      }
      const vx = displaced[0];
      const vy = displaced[1];
      const vz = displaced[2];
      const strata = displaced[3];
      const flute = displaced[4];
      const sunAspect = displaced[5];
      pos.setXYZ(idx, vx, vy, vz);

      const hVal = vy + (altitudeBias || 0);
      if (hVal < -0.50) {
        const t = Math.max(0, Math.min(1, (hVal + 0.76) / 0.26));
        tmp.copy(cDeepMoss).lerp(cMossBase, t);
      } else if (hVal < -0.22) {
        const t = (hVal + 0.50) / 0.28;
        tmp.copy(cMossBase).lerp(cOchreStone, t * 0.55);
      } else if (hVal < 0.16) {
        const t = (hVal + 0.22) / 0.38;
        tmp.copy(cOchreStone).lerp(cGreenShoulder, t * 0.55);
      } else if (hVal < 0.52) {
        const t = (hVal - 0.16) / 0.36;
        tmp.copy(cOchreStone).lerp(cGreenShoulder, 0.55 + t * 0.45);
      } else {
        const t = Math.min(1, (hVal - 0.52) / 0.46);
        tmp.copy(cGreenShoulder).lerp(cMistyPeak, t);
      }
      // 凹谷背阴处染苍黛冷石，凸脊向阳处透微暖赭石
      if (flute < 0 && hVal > -0.35) {
        tmp.lerp(cCoolCrevice, Math.min(0.42, -flute * 0.34 * (1 - sunAspect * 0.4)));
      }

      const bandTone = 1 + strata * 0.038 + (sunAspect - 0.5) * 0.05;
      const gain = faceShade * bandTone;
      colors[idx * 3] = Math.max(0.02, Math.min(1, tmp.r * gain));
      colors[idx * 3 + 1] = Math.max(0.02, Math.min(1, tmp.g * gain));
      colors[idx * 3 + 2] = Math.max(0.02, Math.min(1, tmp.b * gain));
    }
  }

  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// 山环 + 一线天：一整圈低模岩块围住桃源，只在溪尽处开一道窄门。
// 岩块共用一次 draw call；门洞用整石打底、碎岩咬边，凑近看是凿出来的岩缝而不是方盒子。
// 碰撞体沿弧用弦段盒子，门洞两侧另加两块，见 systems/barrier.js。
export function createCliff(cfg, field) {
  const rand = mulberry32(90210);
  const cx = cfg.center[0];
  const cz = cfg.center[1];
  const R = cfg.radius;
  const slitAngle = Math.atan2(cfg.slit[1] - cz, cfg.slit[0] - cx);
  const ux = Math.cos(slitAngle); // 径向，由盆地中心向外
  const uz = Math.sin(slitAngle);
  const tx = -uz;                 // 切向
  const tz = ux;
  const slitX = cx + ux * R;
  const slitZ = cz + uz * R;

  const openW = cfg.openWidth;
  const openH = cfg.openHeight;
  const plugLen = cfg.plugLen;
  const plugDepth = cfg.plugDepth;
  const gateH = cfg.gateHeight;
  const slitRot = -(Math.PI / 2 + slitAngle);
  const groundSlit = field.sample(slitX, slitZ);

  // ---- 岩块 ----
  const geo = createStratifiedCliffGeometry(90217, 0);
  const capGeo = createStratifiedCliffGeometry(90229, 0.14);
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const spots = [];
  const count = cfg.count;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const theta = cfg.arcFrom + (cfg.arcTo - cfg.arcFrom) * t + (rand() - 0.5) * 0.01;
    const rad = R + (rand() - 0.5) * 9;
    const x = cx + Math.cos(theta) * rad;
    const z = cz + Math.sin(theta) * rad;
    // 门洞范围内不摆岩块，否则会堵住窄口
    const along = (x - slitX) * tx + (z - slitZ) * tz;
    const across = (x - slitX) * ux + (z - slitZ) * uz;
    if (Math.abs(along) < plugLen + 1.5 && Math.abs(across) < 16) continue;
    // 越靠两端越矮，跟远山接上
    const edge = Math.min(1, Math.min(t, 1 - t) * 4.2);
    const h = (cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0])) * (0.55 + 0.45 * edge);
    const rr = cfg.radiusRange[0] + rand() * (cfg.radiusRange[1] - cfg.radiusRange[0]);
    const g = field.sample(x, z);
    spots.push({
      x: x,
      z: z,
      y: g + h * 0.5 - h * cfg.sink,
      sx: rr * (0.8 + rand() * 0.5),
      sy: h * 0.5,
      sz: rr * (0.8 + rand() * 0.5),
      rot: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.22
    });
  }

  const group = new THREE.Group();
  group.name = 'cliff';

  const rocks = new THREE.InstancedMesh(geo, rockMat, spots.length);
  rocks.name = 'cliff-rocks';
  const dummy = new THREE.Object3D();
  const cA = new THREE.Color(cfg.color);
  const cB = new THREE.Color(cfg.colorDark);
  const col = new THREE.Color();
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(s.tilt, s.rot, s.tilt * 0.6);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    const vTone = 1.05 - rand() * 0.17;
    col.setRGB(vTone, vTone * 0.995, vTone * 0.988);
    rocks.setColorAt(i, col);
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  // ---- 门洞：两壁 + 门楣（整石打底，颜色压暗，碎岩盖在上面）----
  const plugW = plugLen - openW / 2;
  const sink2 = 2.2;
  const coreMat = new THREE.MeshLambertMaterial({ color: cfg.gateCore || '#8C9186', flatShading: true });
  for (let s = -1; s <= 1; s += 2) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(plugW, gateH + sink2, plugDepth), coreMat);
    const off = (openW / 2 + plugW / 2) * s;
    m.position.set(slitX + tx * off, groundSlit + (gateH - sink2) * 0.5, slitZ + tz * off);
    m.rotation.y = slitRot;
    m.rotation.z = -s * 0.055; // 两壁向上微微张开，像被劈开的岩缝
    group.add(m);
  }
  const headH = gateH - openH;
  const head = new THREE.Mesh(new THREE.BoxGeometry(plugLen * 2, headH + sink2, plugDepth), coreMat);
  // 门楣底边必须正好落在 openH 上：盒高是 headH + sink2，所以中心要抬半个整高。
  // 之前写成 (headH - sink2) * 0.5，门楣压低 2.2 米，三米的缝只剩八十公分的一道地缝。
  head.position.set(slitX, groundSlit + openH + (headH + sink2) * 0.5, slitZ);
  head.rotation.y = slitRot;
  group.add(head);

  // ---- 碎岩包边：洞壁 / 洞顶 / 洞底 / 洞口内沿 / 门外立面 / 门外乱石 ----
  // 局部坐标：t 切向（沿墙），d 径向（沿洞深，负=盆地侧），y 地面以上高度
  const dress = [];
  function putRock(t, d, y, sx, sy, sz, shade) {
    dress.push({
      x: slitX + tx * t + ux * d,
      y: groundSlit + y,
      z: slitZ + tz * t + uz * d,
      sx: sx, sy: sy, sz: sz,
      rx: (rand() - 0.5) * 0.9,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.9,
      shade: shade
    });
  }

  // 洞壁不必再铺碎岩：整条洞挖成不规则断面，本身就是凿开的岩缝。
  // 断面用超椭圆（越大越方）取样，每环按周期噪声向洞心收缩，中间最暗、两端透光。
  const SEG = 24;
  const RINGS = 20;
  const halfD = plugDepth * 0.5;
  const W = openW * 0.5 - 0.015;
  const Hc = openH * 0.5;
  const cy = openH * 0.5;
  const EP = 5;
  const CN = SEG / 2;
  const RN = Math.ceil(RINGS / 2) + 1;
  const table = [];
  for (let i = 0; i < RN; i++) {
    const row = [];
    for (let j = 0; j < CN; j++) row.push(rand());
    table.push(row);
  }
  function nz(i, j) {
    const fi = (i / (RINGS - 1)) * (RN - 1);
    const a0 = Math.min(RN - 2, Math.floor(fi));
    const ti = fi - a0;
    const si = ti * ti * (3 - 2 * ti);
    const fj = (j / SEG) * CN;
    const b0 = Math.floor(fj) % CN;
    const b1 = (b0 + 1) % CN;
    const tj = fj - Math.floor(fj);
    const sj = tj * tj * (3 - 2 * tj);
    const v0 = table[a0][b0] * (1 - sj) + table[a0][b1] * sj;
    const v1 = table[a0 + 1][b0] * (1 - sj) + table[a0 + 1][b1] * sj;
    return v0 * (1 - si) + v1 * si;
  }
  const rockA = new THREE.Color(cfg.gateCore || '#8C9186');
  const rockB = new THREE.Color(cfg.colorDark);
  const linerMoss = new THREE.Color('#5F7358');
  const linerMist = new THREE.Color('#AAB5AC');
  const linerPos = [];
  const linerCol = [];
  const ring = [];
  const tmpc = new THREE.Color();
  for (let i = 0; i < RINGS; i++) {
    const d = -halfD + (i / (RINGS - 1)) * plugDepth;
    const rows = [];
    const drift = Math.sin(i * 0.9) * 0.18;
    for (let j = 0; j < SEG; j++) {
      const th = (j / SEG) * Math.PI * 2;
      const ca = Math.cos(th);
      const sa = Math.sin(th);
      const px = W * Math.sign(ca) * Math.pow(Math.abs(ca), 1 / EP);
      const py = Hc * Math.sign(sa) * Math.pow(Math.abs(sa), 1 / EP);
      // 眼睛高度附近不许凸太多，否则贴壁走会穿模；洞顶可以更乱
      const eyeLine = Math.abs(py) < Hc * 0.45;
      const jitter = ((i * 73856093) ^ (j * 19349663)) % 997 / 997;
      let bump = 0.04 + Math.pow(nz(i, j), 1.35) * (eyeLine ? 0.24 : 0.5) + jitter * 0.09;
      if (py < -Hc * 0.7) bump = Math.min(bump, 0.1);
      if (bump > 0.34) bump = 0.34 + (bump - 0.34) * 0.35;
      if (i === 0 || i === RINGS - 1) bump *= 0.15;
      const k = 1 - bump / Math.max(W, Hc);
      const t = px * k + drift;
      const y = cy + py * k;
      const depth = Math.abs(d) / halfD;
      rows.push({
        x: slitX + tx * t + ux * d,
        y: groundSlit + 0.025 + y,
        z: slitZ + tz * t + uz * d,
        relY: y,
        dVal: d,
        shade: 0.22 + 0.78 * Math.min(1, depth * 1.1)
      });
    }
    ring.push(rows);
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      const a = ring[i][j];
      const b = ring[i][j1];
      const c = ring[i + 1][j1];
      const e = ring[i + 1][j];
      const quad = [a, b, c, a, c, e];
      for (let q = 0; q < 6; q++) {
        const p = quad[q];
        linerPos.push(p.x, p.y, p.z);
        const hNorm = Math.max(0, Math.min(1, p.relY / Math.max(1, openH)));
        const strata = 0.5 + 0.5 * Math.sin(p.relY * 5.4 + p.dVal * 0.42);
        tmpc.copy(rockA).lerp(rockB, 0.35 + strata * 0.28);
        if (hNorm < 0.28) {
          tmpc.lerp(linerMoss, (1 - hNorm / 0.28) * 0.42);
        } else if (hNorm > 0.72) {
          tmpc.lerp(linerMist, ((hNorm - 0.72) / 0.28) * 0.26);
        }
        tmpc.multiplyScalar(p.shade);
        linerCol.push(Math.max(0.02, tmpc.r), Math.max(0.02, tmpc.g), Math.max(0.02, tmpc.b));
      }
    }
  }
  const linerGeo = new THREE.BufferGeometry();
  linerGeo.setAttribute('position', new THREE.Float32BufferAttribute(linerPos, 3));
  linerGeo.setAttribute('color', new THREE.Float32BufferAttribute(linerCol, 3));
  linerGeo.computeVertexNormals();
  const liner = new THREE.Mesh(
    linerGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })
  );
  liner.name = 'gate-liner';
  group.add(liner);

  // 洞口内沿：沿矩形四边咬一圈石头，把直角打碎
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 6; i++) {
      const y = 0.35 + i * 0.84 + rand() * 0.3;
      const rr = 0.55 + rand() * 0.5;
      putRock(
        s * (openW * 0.5 + rr * 0.42),
        -plugDepth * 0.5 - 0.25 + rand() * 0.6,
        y,
        rr * (0.8 + rand() * 0.4), rr * (0.9 + rand() * 0.5), rr * (0.8 + rand() * 0.5),
        0.05 + rand() * 0.75
      );
    }
  }
  for (let i = 0; i < 7; i++) {
    const t = (i / 6 - 0.5) * openW * 1.12;
    const rr = 0.6 + rand() * 0.55;
    putRock(
      t, -plugDepth * 0.5 - 0.2 + rand() * 0.7, openH + rr * 0.3,
      rr * (0.9 + rand() * 0.4), rr * (0.75 + rand() * 0.4), rr * (0.8 + rand() * 0.4),
      0.05 + rand() * 0.7
    );
  }

  // 门外立面：只铺在洞口四周的岩面上。以前是满脸乱撒，
  // 一块半径两米的石头正好糊在缝上，从外面看整座山没有门。
  const halfA = openW * 0.5;
  const halfL = plugLen * 0.46;
  for (let i = 0; i < 96; i++) {
    const rr = 0.7 + rand() * 1.1;
    const sx = rr * (0.9 + rand() * 0.5);
    const sy = rr * (0.8 + rand() * 0.5);
    const sz = rr;
    let t2;
    let y;
    const band = rand();
    if (band < 0.38) {
      t2 = -halfA - sx * 0.8 - 0.1 - rand() * halfL;
      y = 0.35 + rand() * (gateH - 1.5);
    } else if (band < 0.76) {
      t2 = halfA + sx * 0.8 + 0.1 + rand() * halfL;
      y = 0.35 + rand() * (gateH - 1.5);
    } else {
      t2 = (rand() - 0.5) * (halfA * 2 + 3.0);
      y = openH + sy * 0.85 + 0.1 + rand() * Math.max(0.4, gateH - openH - sy - 1.2);
    }
    putRock(
      t2, plugDepth * 0.5 - 0.55 + rand() * 0.35, y,
      sx, sy, sz,
      0.05 + rand() * 0.8
    );
  }

  // 外洞口咬边：门框不能是直角的洞，四角与四边各塞几块半嵌的石头
  for (let sx2 = -1; sx2 <= 1; sx2 += 2) {
    for (let sy2 = 0; sy2 <= 1; sy2++) {
      const rr2 = 0.55 + rand() * 0.4;
      putRock(
        sx2 * (halfA + rr2 * 0.5), plugDepth * 0.5 - 0.1 - rand() * 0.45,
        sy2 ? openH + rr2 * 0.5 : 0.15 + rr2 * 0.35,
        rr2 * (1.0 + rand() * 0.4), rr2 * (0.9 + rand() * 0.4), rr2 * (0.9 + rand() * 0.4),
        0.06 + rand() * 0.7
      );
    }
    for (let i = 0; i < 3; i++) {
      const rr2 = 0.4 + rand() * 0.35;
      putRock(
        sx2 * (halfA + rr2 * 0.65), plugDepth * 0.5 - 0.1 - rand() * 0.45,
        0.45 + (i + 1) * (openH - 0.9) / 4 + (rand() - 0.5) * 0.25,
        rr2 * (1.0 + rand() * 0.4), rr2 * (0.9 + rand() * 0.5), rr2 * (0.8 + rand() * 0.4),
        0.06 + rand() * 0.7
      );
    }
  }
  for (let i = 0; i < 5; i++) {
    const rr2 = 0.45 + rand() * 0.4;
    putRock(
      (i / 4 - 0.5) * (openW + 0.9), plugDepth * 0.5 - 0.1 - rand() * 0.45,
      openH + rr2 * 0.55,
      rr2 * (1.0 + rand() * 0.4), rr2 * (0.8 + rand() * 0.4), rr2 * (0.8 + rand() * 0.4),
      0.06 + rand() * 0.7
    );
  }

  for (let i = 0; i < 26; i++) {
    const rr2 = 0.5 + rand() * 0.8;
    putRock(
      (rand() - 0.5) * (halfA * 2 + 7), plugDepth * 0.5 - 0.4 + rand() * 0.9,
      rr2 * 0.25,
      rr2 * (1.1 + rand() * 0.6), rr2 * (0.5 + rand() * 0.4), rr2 * (1.0 + rand() * 0.5),
      0.1 + rand() * 0.75
    );
  }

  // 洞口两侧地上的塌石
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 7; i++) {
      const rr = 0.32 + rand() * 0.5;
      putRock(
        s * (openW * 0.5 + 0.55 + rand() * 1.5),
        -plugDepth * 0.5 - 0.4 - rand() * 1.6,
        rr * 0.5,
        rr * (1 + rand() * 0.7), rr * (0.7 + rand() * 0.5), rr * (1 + rand() * 0.7),
        0.15 + rand() * 0.7
      );
    }
  }

  const dressGeo = roughRockGeometry(4477, 0, 0.42);
  const dressMesh = new THREE.InstancedMesh(dressGeo, mat, dress.length);
  dressMesh.name = 'cliff-dress';
  for (let i = 0; i < dress.length; i++) {
    const s = dress[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(s.rx, s.ry, s.rz);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    dressMesh.setMatrixAt(i, dummy.matrix);
    col.copy(cA).lerp(cB, s.shade);
    dressMesh.setColorAt(i, col);
  }
  dressMesh.instanceMatrix.needsUpdate = true;
  if (dressMesh.instanceColor) dressMesh.instanceColor.needsUpdate = true;
  dressMesh.computeBoundingSphere();
  group.add(dressMesh);

  // 门楣顶上压几块层理皴石，带竖向苔石至青黛薄雾渐变，破掉方盒子的轮廓
  const capCount = 16;
  const caps = new THREE.InstancedMesh(capGeo, rockMat, capCount);
  caps.name = 'cliff-cap';
  for (let i = 0; i < capCount; i++) {
    const a = (rand() - 0.5) * plugLen * 1.9;
    const d = (rand() - 0.5) * plugDepth * 0.8;
    const sx = 3.2 + rand() * 3.6;
    const sy = 2.6 + rand() * 3.4;
    dummy.position.set(
      slitX + tx * a + ux * d,
      groundSlit + gateH - 1.6 + rand() * 2.6,
      slitZ + tz * a + uz * d
    );
    dummy.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
    dummy.scale.set(sx, sy, sx * (0.8 + rand() * 0.4));
    dummy.updateMatrix();
    caps.setMatrixAt(i, dummy.matrix);
    const cTone = 1.04 - rand() * 0.15;
    col.setRGB(cTone, cTone * 0.996, cTone * 0.99);
    caps.setColorAt(i, col);
  }
  caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
  caps.computeBoundingSphere();
  group.add(caps);

  // ---- 碰撞体：沿弧的弦段（避开门口）+ 门洞两壁 ----
  const blockers = [];
  const segs = 56;
  for (let i = 0; i < segs; i++) {
    const a0 = cfg.arcFrom + ((cfg.arcTo - cfg.arcFrom) * i) / segs;
    const a1 = cfg.arcFrom + ((cfg.arcTo - cfg.arcFrom) * (i + 1)) / segs;
    const am = (a0 + a1) * 0.5;
    const bx = cx + Math.cos(am) * R;
    const bz = cz + Math.sin(am) * R;
    const along = (bx - slitX) * tx + (bz - slitZ) * tz;
    const chord = 2 * R * Math.sin((a1 - a0) * 0.5);
    if (Math.abs(along) < chord * 0.5 + 2.4 + 1.6) continue;
    blockers.push({
      x: bx,
      z: bz,
      hw: chord * 0.5 + 2.4,
      hd: 9,
      rot: -(Math.PI / 2 + am)
    });
  }
  for (let s = -1; s <= 1; s += 2) {
    const off = (openW / 2 + plugW / 2) * s;
    blockers.push({
      x: slitX + tx * off,
      z: slitZ + tz * off,
      hw: plugW * 0.5,
      hd: plugDepth * 0.5 + 1,
      rot: slitRot
    });
  }

  // ---- 重峦叠嶂后景危峰（独立随机源 90288，不触碰前序碰撞体与门洞序列）----
  // 夹峙武陵源窄谷两侧，破除单排等高鹅卵石感，形成前崖、洞门、后峰三叠景深。
  const backRand = mulberry32(90288);
  const peakGeo = createStratifiedCliffGeometry(90243, 0.22);
  const peakSpots = [];
  const flankArcs = [
    [slitAngle - 0.36, slitAngle - 0.085, 10],
    [slitAngle + 0.085, slitAngle + 0.38, 10]
  ];
  for (let b = 0; b < flankArcs.length; b++) {
    const [aStart, aEnd, segCount] = flankArcs[b];
    for (let i = 0; i < segCount; i++) {
      const u = segCount > 1 ? i / (segCount - 1) : 0.5;
      const theta = aStart + (aEnd - aStart) * u + (backRand() - 0.5) * 0.018;
      // 交错于主崖环内侧与脊背之间，避免遮挡晨昏低日槽口
      const rad = R - 11.5 + backRand() * 13.5;
      const px = cx + Math.cos(theta) * rad;
      const pz = cz + Math.sin(theta) * rad;
      const along = (px - slitX) * tx + (pz - slitZ) * tz;
      if (Math.abs(along) < plugLen + 9.2) continue;
      // 靠近峡口双阙处耸峙为主峰，向外翼渐次收缓，与远山气脉相接
      const nearGate = 1 - Math.min(1, Math.max(0, (Math.abs(theta - slitAngle) - 0.09) / 0.30));
      const h = (26 + backRand() * 14.5) * (0.76 + 0.26 * nearGate);
      const rr = 10.5 + backRand() * 5.8;
      const gy = field.sample(px, pz);
      peakSpots.push({
        x: px,
        z: pz,
        y: gy + h * 0.5 - h * (cfg.sink + 0.04),
        sx: rr * (0.82 + backRand() * 0.36),
        sy: h * 0.5,
        sz: rr * (0.78 + backRand() * 0.38),
        rot: backRand() * Math.PI * 2,
        tilt: (backRand() - 0.5) * 0.16,
        tone: 0.94 + backRand() * 0.12
      });
    }
  }
  const backPeaks = new THREE.InstancedMesh(peakGeo, rockMat, peakSpots.length);
  backPeaks.name = 'cliff-back-peaks';
  for (let i = 0; i < peakSpots.length; i++) {
    const s = peakSpots[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(s.tilt, s.rot, -s.tilt * 0.5);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    backPeaks.setMatrixAt(i, dummy.matrix);
    col.setRGB(s.tone * 0.96, s.tone * 0.99, s.tone * 1.01);
    backPeaks.setColorAt(i, col);
  }
  backPeaks.instanceMatrix.needsUpdate = true;
  if (backPeaks.instanceColor) backPeaks.instanceColor.needsUpdate = true;
  backPeaks.computeBoundingSphere();
  group.add(backPeaks);

  return {
    group: group,
    blockers: blockers,
    slit: { x: slitX, z: slitZ, angle: slitAngle, ground: groundSlit, gap: openW }
  };
}