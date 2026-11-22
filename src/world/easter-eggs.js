import * as THREE from 'three';
import { createHabitatContext, habitatSiteSafe, habitatSurface } from './habitat-details.js';
import { createGroveBaker } from './leisure-grove-geometry.js';

const TAU = Math.PI * 2;
const boxDistance = (x, z, b) => {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.hw), Math.max(0, Math.abs(dx * s + dz * c) - b.hd));
};

const EGG_SPECS = [
  {
    id: 'qin-bamboo-slips',
    name: '先秦竹简残卷',
    action: '展读',
    line: '「乃不知有汉，无论魏晋——苔石上几卷残简还记着秦末入谷、头一回开荒播种的时节。」',
    soundKind: 'wood',
    radius: 1.6
  },
  {
    id: 'floating-wine-cup',
    name: '曲水漆耳杯',
    action: '临流',
    line: '「水石槽中一只朱黑漆耳杯浮沉打转，载着两片落桃，似方才还有村人在此曲水流觞。」',
    soundKind: 'water',
    radius: 1.5
  },
  {
    id: 'camphor-hollow-brew',
    name: '古树洞藏桃花酿',
    action: '轻嗅',
    line: '「老根树洞深处藏着一只泥封小陶瓮，揭泥微嗅，满是春日采酿的桃花米酒香。」',
    soundKind: 'jar',
    radius: 1.6
  },
  {
    id: 'cloud-guqin-stone',
    name: '云台卧石古琴',
    action: '拨弦',
    line: '「石坪上素漆七弦清越鸣响，散音袅袅穿过竹梢，与山风溪声合为一曲。」',
    soundKind: 'guqin',
    radius: 1.6
  },
  {
    id: 'peach-wind-tallies',
    name: '桃枝祈岁木牌',
    action: '轻抚',
    line: '「素木牌悬在老桃低枝，只刻着‘岁稔人和、风调雨顺’，山风过处轻敲作响。」',
    soundKind: 'bell',
    radius: 1.5
  },
  {
    id: 'moon-white-stag',
    name: '幽林白鹿',
    action: '静观',
    line: '「霜色白鹿立于青松碎石旁安然回首，见人亦不惊避，只轻轻点头复又低头饮露。」',
    soundKind: 'stag',
    radius: 1.7
  }
];

/**
 * 六处可交互探索的桃源奇遇彩蛋：
 * - 先秦竹简残卷（洞口内青苔石案）
 * - 曲水漆耳杯（池畔引泉石槽，水上动态飘转）
 * - 古树洞藏桃花酿（大树旁树洞封酿，香雾浮粒）
 * - 云台卧石古琴（竹林高坡石台，按 E 可实时奏古琴泛音）
 * - 桃枝祈岁木牌（桃林果园旁随风轻晃木牌）
 * - 幽林白鹿（深林静处颔首呼吸的白鹿）
 */
export function createEasterEggs(options = {}) {
  const { world, field } = options;
  const group = new THREE.Group();
  group.name = 'easter-eggs';

  const targets = [];
  const sites = [];
  const blockers = [];
  const baker = createGroveBaker();
  const surface = (x, z) => (field ? habitatSurface(field, x, z) : 0);

  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const dynMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#FFF0C2', transparent: true, opacity: 0.72, fog: false });
  glowMat.userData.skyIgnore = true;
  const dewMat = new THREE.MeshBasicMaterial({ color: '#E6F5F0', vertexColors: true, transparent: true, opacity: 0.84, depthWrite: false });
  dewMat.userData.skyIgnore = true;
  const dewLightCol = new THREE.Color();

  function buildPineDewGeometry() {
    const pos = [];
    const col = [];
    const idx = [];
    const cTip = new THREE.Color('#F8FDFA');
    const cMid = new THREE.Color('#DDF3ED');
    const cBot = new THREE.Color('#C4E6DE');
    pos.push(0, 0.032, 0);
    col.push(cTip.r, cTip.g, cTip.b);
    const sides = 6;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      pos.push(Math.cos(a) * 0.015, -0.006, Math.sin(a) * 0.015);
      col.push(cMid.r, cMid.g, cMid.b);
    }
    pos.push(0, -0.022, 0);
    col.push(cBot.r, cBot.g, cBot.b);
    const botIdx = sides + 1;
    for (let i = 0; i < sides; i++) {
      const a = 1 + i;
      const b = 1 + ((i + 1) % sides);
      idx.push(0, b, a);
      idx.push(botIdx, a, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  let context = null;
  if (world && field) {
    context = createHabitatContext(options);
    context.cfg = { ...context.cfg, maxSlope: 0.42, clearance: 0.25 };
    for (const src of [options.pondLife, options.waterworks, options.leisureGrove, options.qinHanHomestead]) {
      if (!src) continue;
      const r = src.layout?.reservations || src.reservations || [];
      for (const q of Array.isArray(r) ? r : []) {
        if (Number.isFinite(q?.x) && Number.isFinite(q?.z) && Number.isFinite(q?.radius)) {
          context.reservations.circles.push({ x: q.x, z: q.z, r: q.radius });
        }
      }
      for (const b of src.blockers || []) {
        if ([b?.x, b?.z, b?.hw, b?.hd].every(Number.isFinite)) context.reservations.boxes.push(b);
      }
    }
  }

  function findClearSite(anchors, radius, maxDelta = 0.45) {
    if (!field) return { x: anchors[0][0], z: anchors[0][1], y: 0 };
    for (const a of anchors) {
      for (let i = 0; i < 420; i++) {
        const ang = i * 2.399963229728653;
        const rr = 14 * Math.sqrt(i / 419);
        const x = Math.round((a[0] + Math.cos(ang) * rr) * 100) / 100;
        const z = Math.round((a[1] + Math.sin(ang) * rr) * 100) / 100;
        if (sites.some(s => Math.hypot(s.x - x, s.z - z) < radius + 4.5)) continue;
        if (context && !habitatSiteSafe(x, z, radius, context)) continue;
        const y = surface(x, z);
        if (!Number.isFinite(y) || y < (world?.terrain?.waterLevel ?? -1) + 0.35) continue;
        let delta = 0;
        for (let k = 0; k < 8; k++) {
          delta = Math.max(delta, Math.abs(surface(x + Math.cos(k * TAU / 8) * radius, z + Math.sin(k * TAU / 8) * radius) - y));
        }
        if (delta <= maxDelta) {
          if (context) context.reservations.circles.push({ x, z, r: radius + 0.5, source: 'easter-egg' });
          return { x, z, y };
        }
      }
    }
    const fb = anchors[0];
    return { x: fb[0], z: fb[1], y: surface(fb[0], fb[1]) };
  }

  const basin = world?.terrain?.basin || { x: 24, z: -130 };
  const pond = world?.terrain?.pond || { x: 24, z: -120, radius: 14 };
  const slit = options?.cliff?.slit || world?.cliff?.slit || { x: 18, z: -30 };

  const ANCHORS = {
    'qin-bamboo-slips': [[slit.x + 8, slit.z - 22], [12, -58], [32, -62]],
    'floating-wine-cup': [[pond.x - pond.radius - 4.5, pond.z + 2], [pond.x + pond.radius + 4.5, pond.z - 4], [pond.x, pond.z - pond.radius - 4]],
    'camphor-hollow-brew': [[-6, -114], [70, -198], [-12, -148]],
    'cloud-guqin-stone': [[96, -114], [92, -172], [-22, -170]],
    'peach-wind-tallies': [[76, -188], [16, -82], [-8, -184]],
    'moon-white-stag': [[-28, -178], [88, -196], [56, -214]]
  };

  // 动态组件列表，由单个 dynamic batch 或少数轻量分组驱动
  const animActors = {
    cupGroup: null,
    cupBaseX: 0,
    cupBaseZ: 0,
    cupOriginY: 0,
    cupDriftAngle: 0,
    cupNudge: 0,
    tallies: [],
    aromaMotes: [],
    stagGroup: null,
    stagHeadGroup: null,
    stagEarL: null,
    stagEarR: null,
    stagOriginY: 0,
    stagGreetTimer: 0,
    stagEarFlutter: 0,
    stagEarFlutterTotal: 2.4,
    stagStartleLift: 0,
    stagProximityCooldown: 0,
    stagStartleCooldown: 0,
    stagDewMesh: null,
    stagDewDrops: [],
    stagDewActive: 0,
    stagDewShowers: 0,
    stagSound: null,
    shimmerRings: [],
    disposed: false
  };

  const topColTmp = new THREE.Color();
  const bellyColTmp = new THREE.Color();
  const mixColTmp = new THREE.Color();
  function bakeLoft(b, sections, sides, topColors, bellyHex = null) {
    const bellyCol = bellyHex ? bellyColTmp.set(bellyHex) : null;
    const pt = (sec, j) => {
      const a = (j / sides) * TAU;
      return [sec[0] + Math.cos(a) * sec[3], sec[1] + Math.sin(a) * sec[4], sec[2]];
    };
    const ringHex = (bandIdx, sy) => {
      topColTmp.set(topColors[Math.min(topColors.length - 1, bandIdx)]);
      if (bellyCol) {
        const w = Math.max(0, Math.min(1, (-sy + 0.15) * 0.85));
        mixColTmp.copy(topColTmp).lerp(bellyCol, w);
        return '#' + mixColTmp.getHexString();
      }
      return '#' + topColTmp.getHexString();
    };
    for (let i = 0; i < sections.length - 1; i++) {
      const s0 = sections[i], s1 = sections[i + 1];
      for (let j = 0; j < sides; j++) {
        const jn = (j + 1) % sides;
        const sy = Math.sin(((j + 0.5) / sides) * TAU);
        const hex = ringHex(i, sy);
        const p00 = pt(s0, j), p01 = pt(s0, jn);
        const p10 = pt(s1, j), p11 = pt(s1, jn);
        b.tri(p00, p01, p10, hex);
        b.tri(p01, p11, p10, hex);
      }
    }
    for (const [idx, isEnd] of [[0, false], [sections.length - 1, true]]) {
      const sec = sections[idx];
      const c = [sec[0], sec[1], sec[2]];
      const hex = ringHex(isEnd ? Math.max(0, idx - 1) : 0, 0.2);
      for (let j = 0; j < sides; j++) {
        const p0 = pt(sec, j), p1 = pt(sec, (j + 1) % sides);
        if (isEnd) b.tri(c, p0, p1, hex);
        else b.tri(c, p1, p0, hex);
      }
    }
  }

  function makeMiniMesh(buildFn, pos, name, parent = group) {
    const b = createGroveBaker();
    buildFn(b);
    const m = b.finish('solid', dynMat);
    b.dispose();
    if (m) {
      m.name = name;
      m.position.set(pos[0], pos[1], pos[2]);
      m.matrixAutoUpdate = true;
      parent.add(m);
    }
    return m;
  }

  function localP(ox, oy, oz, rot, lx, ly, lz) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [ox + lx * c + lz * s, oy + ly, oz - lx * s + lz * c];
  }

  function bakeChamferStone(ox, oy, oz, w, h, d, rot, topCol, sideCol, chamfer = 0.12, taper = 0.06) {
    const hx = w * 0.5, hz = d * 0.5;
    const ch = Math.min(chamfer, hx * 0.42, hz * 0.42);
    const ring = (ly, sx, sz, sc) => {
      const rx = hx * sx, rz = hz * sz, rc = ch * sc;
      const pts = [
        [rx - rc, rz], [rx, rz - rc], [rx, -rz + rc], [rx - rc, -rz],
        [-rx + rc, -rz], [-rx, -rz + rc], [-rx, rz - rc], [-rx + rc, rz]
      ];
      return pts.map(([lx, lz]) => localP(ox, oy, oz, rot, lx, ly, lz));
    };
    const r0 = ring(0, 1 + taper, 1 + taper, 0.85);
    const r1 = ring(h * 0.76, 1.0, 1.0, 1.0);
    const r2 = ring(h, 1 - taper * 1.1, 1 - taper * 1.1, 1.18);
    const topC = localP(ox, oy, oz, rot, 0, h, 0);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      baker.quad(r0[i], r0[j], r1[j], r1[i], sideCol);
      baker.quad(r1[i], r1[j], r2[j], r2[i], topCol);
      baker.tri(topC, r2[i], r2[j], topCol);
    }
  }

  for (const spec of EGG_SPECS) {
    const pos = findClearSite(ANCHORS[spec.id], spec.radius);
    const { x, z } = pos;
    const y = surface(x, z);
    const rot = (sites.length * 1.15) % TAU;

    if (spec.id === 'qin-bamboo-slips') {
      const p = (lx, ly, lz) => localP(x, y, z, rot, lx, ly, lz);
      // 二层天然倒角青苔石案 + 倒角石坐墩 + 案面先秦竹简、卷简、凹槽石砚与石镇尺
      bakeChamferStone(x, y - 0.08, z, 1.44, 0.28, 1.00, rot, '#7F867A', '#6E756A', 0.18, 0.08);
      bakeChamferStone(x, y + 0.19, z, 1.26, 0.30, 0.84, rot, '#92988B', '#80877B', 0.14, 0.05);
      const seatP = p(-0.48, -0.06, 0.76);
      bakeChamferStone(seatP[0], seatP[1], seatP[2], 0.60, 0.36, 0.44, rot + 0.22, '#878E80', '#757C70', 0.12, 0.08);
      baker.orb(p(0.56, 0.20, -0.34), [0.28, 0.18, 0.24], '#6B7E58', 'solid', 1.1);
      baker.orb(p(-0.46, 0.495, -0.26), [0.22, 0.04, 0.16], '#627952', 'solid', 2.2);
      // 铺开的七枚古竹简（与石案精确同向旋转）+ 两道韦编皮绳 + 青石镇尺
      for (let s = 0; s < 7; s++) {
        const lx = -0.24 + s * 0.066;
        baker.block(p(lx, 0.502, -0.02), [0.052, 0.016, 0.40], s % 2 ? '#D3C092' : '#C5AF81', [0, rot + (s - 3) * 0.015, 0]);
      }
      baker.block(p(-0.04, 0.513, -0.13), [0.47, 0.008, 0.022], '#5B4533', [0, rot, 0]);
      baker.block(p(-0.04, 0.513, 0.09), [0.47, 0.008, 0.022], '#5B4533', [0, rot, 0]);
      baker.block(p(-0.34, 0.516, -0.02), [0.036, 0.026, 0.28], '#636B64', [0, rot + 0.05, 0]); // 石镇尺
      // 案侧卷起的另一卷竹简与麻绳系带
      baker.beam(p(-0.22, 0.532, 0.27), p(0.16, 0.532, 0.24), 0.038, '#CBB585', 0.038, 8);
      baker.beam(p(-0.05, 0.532, 0.256), p(-0.01, 0.532, 0.253), 0.041, '#684B36', 0.041, 8);
      // 凹池石砚 + 墨池 + 小竹笔
      baker.block(p(0.36, 0.514, 0.06), [0.19, 0.042, 0.24], '#5A5E60', [0, rot + 0.18, 0]);
      baker.block(p(0.36, 0.534, 0.05), [0.13, 0.008, 0.16], '#2D3032', [0, rot + 0.18, 0]);
      baker.beam(p(0.28, 0.506, -0.22), p(0.50, 0.506, -0.14), 0.010, '#A58E5C', 0.009, 5);
      baker.beam(p(0.50, 0.506, -0.14), p(0.54, 0.506, -0.125), 0.012, '#343230', 0.003, 5);
      blockers.push({ x, z, hw: 0.72, hd: 0.52, minY: y, maxY: y + 0.65, rot, source: 'easter-' + spec.id });
    } else if (spec.id === 'floating-wine-cup') {
      // 曲水流觞青石涌泉钵（二阶收腰倒角石钵 + 苔石泉眼 + 竹引山泉细流 + 水面旋转朱漆羽觞）
      const basinGeo = new THREE.LatheGeometry([
        new THREE.Vector2(0.01, -0.04),
        new THREE.Vector2(1.04, -0.04),
        new THREE.Vector2(1.00, 0.09),
        new THREE.Vector2(0.90, 0.14),
        new THREE.Vector2(0.95, 0.30),
        new THREE.Vector2(1.00, 0.37),
        new THREE.Vector2(0.94, 0.41),
        new THREE.Vector2(0.75, 0.41),
        new THREE.Vector2(0.72, 0.35),
        new THREE.Vector2(0.70, 0.10),
        new THREE.Vector2(0.01, 0.08)
      ], 12);
      baker.add(basinGeo, [x, y, z], [1, 1, 1], '#889084', [0, rot, 0]);
      basinGeo.dispose();
      // 钵内微光山泉水面（齐平于羽觞浮面）
      baker.beam([x, y + 0.10, z], [x, y + 0.305, z], 0.72, '#6E9A8B', 0.72, 12);
      // 钵畔天然苔石涌泉座 + 曲竹引泉水嘴与垂落清流
      bakeChamferStone(x + 0.96, y - 0.06, z - 0.36, 0.62, 0.56, 0.54, 0.4, '#848C7F', '#727A6E', 0.14, 0.12);
      bakeChamferStone(x + 0.68, y - 0.06, z - 0.78, 0.46, 0.30, 0.40, 1.1, '#7D8578', '#6B7367', 0.10, 0.10);
      baker.orb([x + 0.94, y + 0.49, z - 0.36], [0.22, 0.06, 0.19], '#617952', 'solid', 2.4);
      baker.beam([x + 1.02, y + 0.50, z - 0.38], [x + 0.64, y + 0.43, z - 0.24], 0.040, '#6B8850', 0.036, 7);
      baker.beam([x + 0.84, y + 0.465, z - 0.31], [x + 0.80, y + 0.458, z - 0.295], 0.045, '#546E3E', 0.045, 7);
      baker.beam([x + 0.65, y + 0.42, z - 0.24], [x + 0.57, y + 0.305, z - 0.21], 0.014, '#AED2C6', 0.018, 5);
      baker.peach([x + 0.56, y + 0.312, z - 0.20], [0.065, 0.010, 0.065], '#C8E2D8'); // 落水微沫
      baker.peach([x - 0.42, y + 0.314, z + 0.22], [0.032, 0.008, 0.024], '#EEB3BC'); // 水面零星落瓣
      baker.peach([x - 0.18, y + 0.314, z - 0.46], [0.026, 0.008, 0.020], '#F4C8CF');

      const cupOriginY = y + 0.315;
      animActors.cupBaseX = x;
      animActors.cupBaseZ = z;
      animActors.cupOriginY = cupOriginY;
      animActors.cupGroup = makeMiniMesh(b => {
        // 椭圆弧腹汉代朱黑漆耳杯（羽觞）
        bakeLoft(b, [
          [0, 0.018, -0.105, 0.048, 0.024],
          [0, 0.016, -0.045, 0.074, 0.032],
          [0, 0.016, 0.045, 0.074, 0.032],
          [0, 0.018, 0.105, 0.048, 0.024]
        ], 6, ['#8E382E', '#9B3F34', '#8E382E'], '#4A1F1A');
        b.beam([0, 0.026, 0], [0, 0.042, 0], 0.056, '#2E211F', 0.058, 8); // 黑漆酒液内膛
        for (const side of [-1, 1]) {
          b.block([side * 0.082, 0.028, 0], [0.032, 0.012, 0.125], '#A24538'); // 弧翼双耳
        }
        b.peach([0.018, 0.046, 0.015], [0.024, 0.009, 0.019], '#E8AEB7'); // 落桃瓣
        b.peach([-0.020, 0.045, -0.022], [0.020, 0.008, 0.016], '#F2C2CA');
      }, [x + 0.31, cupOriginY, z], 'easter-floating-cup');
      blockers.push({ x, z, hw: 0.98, hd: 0.98, minY: y, maxY: y + 0.5, rot: 0, source: 'easter-' + spec.id });
    } else if (spec.id === 'camphor-hollow-brew') {
      // 古樟老根敞口树洞（正面敞开天然树洞显露红泥封酒瓮 + 盘地根瘤苔石 + 老干新萌樟枝绿冠）
      const segs = 12;
      const openMid = Math.PI * 0.36; // 朝向前方视角敞开树洞
      const hProfile = i => {
        const a = (i / segs) * TAU;
        const diff = Math.abs(Math.atan2(Math.sin(a - openMid), Math.cos(a - openMid)));
        if (diff < 0.72) return 0.14; // 敞口低门槛，便于一眼看清洞内桃花酿酒瓮
        return 0.88 + 0.42 * Math.sin(a * 1.5 + 1.1) + (diff > 2.0 ? 0.22 : 0);
      };
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU;
        const a1 = ((i + 1) / segs) * TAU;
        const h0 = hProfile(i);
        const h1 = hProfile((i + 1) % segs);
        const barkCol = i % 2 === 0 ? '#584433' : '#644E3A';
        const innerCol = '#3A2C20';
        const cutCol = '#7E654A';
        const rB0 = 0.74 + 0.06 * Math.sin(a0 * 3);
        const rB1 = 0.74 + 0.06 * Math.sin(a1 * 3);
        const rT0 = 0.58 + 0.05 * Math.cos(a0 * 2);
        const rT1 = 0.58 + 0.05 * Math.cos(a1 * 2);
        const rI = 0.45;
        const oB0 = [x + Math.cos(a0) * rB0, y - 0.06, z + Math.sin(a0) * rB0];
        const oB1 = [x + Math.cos(a1) * rB1, y - 0.06, z + Math.sin(a1) * rB1];
        const oT0 = [x + Math.cos(a0) * rT0, y + h0, z + Math.sin(a0) * rT0];
        const oT1 = [x + Math.cos(a1) * rT1, y + h1, z + Math.sin(a1) * rT1];
        const iB0 = [x + Math.cos(a0) * rI, y + 0.04, z + Math.sin(a0) * rI];
        const iB1 = [x + Math.cos(a1) * rI, y + 0.04, z + Math.sin(a1) * rI];
        const iT0 = [x + Math.cos(a0) * (rI - 0.03), y + h0, z + Math.sin(a0) * (rI - 0.03)];
        const iT1 = [x + Math.cos(a1) * (rI - 0.03), y + h1, z + Math.sin(a1) * (rI - 0.03)];
        baker.quad(oB0, oB1, oT1, oT0, barkCol);
        baker.quad(iB1, iB0, iT0, iT1, innerCol);
        baker.quad(oT0, oT1, iT1, iT0, cutCol);
      }
      // 树洞底垫木土台
      baker.beam([x, y - 0.02, z], [x, y + 0.09, z], 0.48, '#463728', 0.46, 10);
      // 五条抓地盘曲老樟根 + 根间青苔石
      for (let r = 0; r < 5; r++) {
        const ra = openMid + 0.95 + (r / 4) * (TAU - 1.9);
        const midR = 0.72, farR = 1.06 + (r % 2) * 0.14;
        baker.beam([x + Math.cos(ra) * 0.54, y + 0.42, z + Math.sin(ra) * 0.54], [x + Math.cos(ra) * midR, y + 0.14, z + Math.sin(ra) * midR], 0.14, '#5A4634', 0.11, 6);
        baker.beam([x + Math.cos(ra) * midR, y + 0.14, z + Math.sin(ra) * midR], [x + Math.cos(ra) * farR, y - 0.05, z + Math.sin(ra) * farR], 0.11, '#4E3C2C', 0.05, 5);
      }
      bakeChamferStone(x - 0.68, y - 0.06, z + 0.42, 0.48, 0.24, 0.38, 0.6, '#848C7F', '#727A6E', 0.10, 0.12);
      baker.orb([x - 0.52, y + 0.22, z - 0.48], [0.24, 0.10, 0.20], '#5E774F', 'solid', 1.8);
      // 古桩后肩抽生的一枝翠绿新樟枝（点明古木逢春、非枯废木桶）
      const sprA = openMid + Math.PI;
      const sx0 = x + Math.cos(sprA) * 0.50, sz0 = z + Math.sin(sprA) * 0.50;
      const sx1 = sx0 + Math.cos(sprA - 0.4) * 0.42, sz1 = sz0 + Math.sin(sprA - 0.4) * 0.42;
      const sx2 = sx1 + Math.cos(sprA + 0.3) * 0.38, sz2 = sz1 + Math.sin(sprA + 0.3) * 0.38;
      baker.beam([sx0, y + 1.02, sz0], [sx1, y + 1.54, sz1], 0.065, '#5F4936', 0.042, 6);
      baker.beam([sx1, y + 1.52, sz1], [sx2, y + 1.86, sz2], 0.042, '#69523D', 0.020, 5);
      baker.beam([sx1, y + 1.48, sz1], [sx1 - 0.36, y + 1.72, sz1 + 0.24], 0.032, '#69523D', 0.016, 5);
      baker.orb([sx2, y + 1.92, sz2], [0.46, 0.22, 0.40], '#4D7644', 'solid', 1.3);
      baker.orb([sx1 - 0.36, y + 1.76, sz1 + 0.24], [0.38, 0.19, 0.34], '#5D884F', 'solid', 2.9);
      baker.orb([sx1 + 0.10, y + 1.66, sz1 - 0.12], [0.34, 0.17, 0.30], '#6B9458', 'solid', 4.1);
      // 树洞深处鼓腹收口泥封桃花酒瓮（LatheGeometry + 红泥穹封 + 朱红系绸）
      const wineJar = new THREE.LatheGeometry([
        new THREE.Vector2(0.01, 0),
        new THREE.Vector2(0.14, 0),
        new THREE.Vector2(0.24, 0.16),
        new THREE.Vector2(0.25, 0.34),
        new THREE.Vector2(0.17, 0.48),
        new THREE.Vector2(0.13, 0.54),
        new THREE.Vector2(0.16, 0.57),
        new THREE.Vector2(0.12, 0.58)
      ], 10);
      baker.add(wineJar, [x, y + 0.08, z + 0.04], [1, 1, 1], '#937C66', [0, 0, 0]);
      wineJar.dispose();
      // 红泥拱封顶盖与朱红绸带口箍
      const sealGeo = new THREE.LatheGeometry([
        new THREE.Vector2(0.145, 0),
        new THREE.Vector2(0.135, 0.05),
        new THREE.Vector2(0.08, 0.095),
        new THREE.Vector2(0.01, 0.11)
      ], 9);
      baker.add(sealGeo, [x, y + 0.63, z + 0.04], [1, 1, 1], '#AD5D48', [0, 0, 0]);
      sealGeo.dispose();
      baker.beam([x, y + 0.56, z + 0.04], [x, y + 0.62, z + 0.04], 0.156, '#B8463E', 0.156, 10);
      for (let m = 0; m < 4; m++) {
        const mote = makeMiniMesh(b => b.peach([0, 0, 0], [0.032, 0.032, 0.032], '#F0B6BE'), [x, y + 0.75 + m * 0.16, z], 'easter-aroma-' + m);
        if (mote) animActors.aromaMotes.push({ mesh: mote, bx: x, by: y + 0.72, bz: z, phase: m * 1.55 });
      }
      blockers.push({ x, z, hw: 0.80, hd: 0.80, minY: y, maxY: y + 1.1, rot: 0, source: 'easter-' + spec.id });
    } else if (spec.id === 'cloud-guqin-stone') {
      const p = (lx, ly, lz) => localP(x, y, z, rot, lx, ly, lz);
      // 二层天然叠石青石云台 + 苔石坐墩 + 仲尼式束腰漆木七弦古琴
      bakeChamferStone(x, y - 0.08, z, 1.84, 0.28, 0.96, rot, '#81887C', '#6F776B', 0.20, 0.08);
      bakeChamferStone(x, y + 0.19, z, 1.58, 0.37, 0.76, rot, '#949B8E', '#81897D', 0.14, 0.05);
      const seatP = p(0, -0.06, -0.78);
      bakeChamferStone(seatP[0], seatP[1], seatP[2], 0.68, 0.38, 0.46, rot + 0.08, '#878E81', '#747C70', 0.12, 0.08);
      baker.orb(p(-0.68, 0.56, 0.22), [0.22, 0.045, 0.16], '#627952', 'solid', 1.7);
      baker.orb(p(0.76, 0.22, -0.26), [0.24, 0.14, 0.22], '#6C8059', 'solid', 3.4);

      // 仲尼式七弦古琴（双雁足托起 + 琴额/琴肩/收项/束腰/凤尾分段琴身 + 岳山/龙龈/七弦/徽位）
      const qBase = 0.578;
      // 琴底双雁足
      baker.beam(p(0.28, 0.555, -0.04), p(0.28, qBase, -0.04), 0.016, '#3B251C', 0.016, 6);
      baker.beam(p(0.28, 0.555, 0.04), p(0.28, qBase, 0.04), 0.016, '#3B251C', 0.016, 6);
      baker.beam(p(-0.36, 0.555, 0), p(-0.36, qBase, 0), 0.018, '#3B251C', 0.018, 6);
      // 仲尼式琴体轮廓（沿局部 X 从琴尾 -0.58 到琴额 +0.58，宽额、收项、宽肩、收腰、狭尾）
      const qinProfile = [
        [-0.58, 0.068, 0.030], // 凤尾
        [-0.36, 0.074, 0.036],
        [-0.22, 0.066, 0.036], // 收腰
        [-0.10, 0.088, 0.042], // 中腹
        [0.24, 0.112, 0.046],  // 宽肩
        [0.36, 0.092, 0.044],  // 仲尼收项
        [0.44, 0.110, 0.046],  // 琴额
        [0.58, 0.096, 0.040]   // 额首
      ];
      for (let i = 0; i < qinProfile.length - 1; i++) {
        const [x0, w0, h0] = qinProfile[i];
        const [x1, w1, h1] = qinProfile[i + 1];
        const bL0 = p(x0, qBase, -w0), bR0 = p(x0, qBase, w0);
        const bL1 = p(x1, qBase, -w1), bR1 = p(x1, qBase, w1);
        const tL0 = p(x0, qBase + h0 * 0.72, -w0 * 0.92), tR0 = p(x0, qBase + h0 * 0.72, w0 * 0.92);
        const tL1 = p(x1, qBase + h1 * 0.72, -w1 * 0.92), tR1 = p(x1, qBase + h1 * 0.72, w1 * 0.92);
        const c0 = p(x0, qBase + h0, 0), c1 = p(x1, qBase + h1, 0);
        // 拱形漆木琴面与侧边
        baker.quad(tL0, c0, c1, tL1, '#58372A');
        baker.quad(c0, tR0, tR1, c1, '#4C2F24');
        baker.quad(bL0, tL0, tL1, bL1, '#3D241B');
        baker.quad(tR0, bR0, bR1, tR1, '#3D241B');
      }
      // 岳山（右端高桥）与龙龈（左端尾枕）
      baker.block(p(0.45, qBase + 0.056, 0), [0.026, 0.028, 0.19], '#E2CB97', [0, rot, 0]);
      baker.block(p(-0.52, qBase + 0.044, 0), [0.022, 0.018, 0.125], '#D7BE89', [0, rot, 0]);
      // 7 根蚕丝琴弦（自岳山绷至龙龈）
      for (let st = -3; st <= 3; st++) {
        const zHead = st * 0.024;
        const zTail = st * 0.016;
        baker.beam(p(-0.52, qBase + 0.052, zTail), p(0.45, qBase + 0.066, zHead), 0.0032, '#EBE3C8', 0.0032, 4);
      }
      // 螺钿徽位星点
      for (const hx of [-0.34, -0.18, -0.02, 0.14, 0.28]) {
        baker.block(p(hx, qBase + 0.044, -0.072), [0.012, 0.006, 0.012], '#ECE7D5', [0, rot, 0]);
      }
      blockers.push({ x, z, hw: 0.88, hd: 0.65, minY: y, maxY: y + 0.75, rot, source: 'easter-' + spec.id });
    } else if (spec.id === 'peach-wind-tallies') {
      // 苍古曲干老桃树（根畔青苔石 + 三段曲干 + 斜逸主枝与分叉小枝 + 层叠桃花云簇 + 朱绳祈岁木牍）
      bakeChamferStone(x - 0.18, y - 0.08, z + 0.14, 0.74, 0.30, 0.62, 0.5, '#868D80', '#737B6F', 0.15, 0.12);
      baker.orb([x - 0.22, y + 0.23, z + 0.12], [0.22, 0.06, 0.18], '#617952', 'solid', 2.6);
      // 苍劲曲折老桃干
      baker.beam([x, y - 0.12, z], [x + 0.08, y + 0.68, z - 0.04], 0.175, '#523E30', 0.132, 7);
      baker.beam([x + 0.07, y + 0.64, z - 0.04], [x - 0.04, y + 1.38, z + 0.04], 0.132, '#5C4535', 0.102, 7);
      baker.beam([x - 0.03, y + 1.34, z + 0.04], [x + 0.18, y + 1.92, z + 0.02], 0.102, '#624A39', 0.072, 7);
      // 优雅弧拱的悬牌主枝（分两节微翘，非直角路灯杆）
      baker.beam([x + 0.16, y + 1.86, z + 0.02], [x + 0.86, y + 2.02, z + 0.09], 0.068, '#5E4737', 0.046, 6);
      baker.beam([x + 0.84, y + 2.01, z + 0.09], [x + 1.54, y + 2.22, z + 0.20], 0.046, '#664E3D', 0.022, 6);
      // 向上舒展的对生分叉小枝
      baker.beam([x + 0.14, y + 1.88, z + 0.02], [x - 0.42, y + 2.38, z - 0.18], 0.056, '#5D4636', 0.024, 6);
      baker.beam([x + 0.56, y + 1.94, z + 0.06], [x + 0.72, y + 2.48, z - 0.22], 0.038, '#664E3D', 0.018, 5);
      baker.beam([x + 1.12, y + 2.10, z + 0.13], [x + 1.38, y + 2.44, z - 0.08], 0.030, '#664E3D', 0.014, 5);

      // 十叠轻柔扁云状桃花簇 + 嫩绿春梢
      const sprays = [
        [x - 0.44, y + 2.42, z - 0.18, [0.46, 0.24, 0.40], '#EEB4BD'],
        [x - 0.14, y + 2.28, z - 0.06, [0.42, 0.22, 0.36], '#F4CCD2'],
        [x + 0.22, y + 2.12, z + 0.04, [0.38, 0.20, 0.34], '#E8A5B0'],
        [x + 0.58, y + 2.48, z - 0.22, [0.44, 0.22, 0.38], '#F2C3CA'],
        [x + 0.80, y + 2.22, z + 0.10, [0.36, 0.19, 0.32], '#ECAEB8'],
        [x + 1.14, y + 2.26, z + 0.14, [0.38, 0.20, 0.34], '#F5CED4'],
        [x + 1.38, y + 2.44, z - 0.08, [0.36, 0.19, 0.30], '#EEB4BD'],
        [x + 1.56, y + 2.26, z + 0.22, [0.32, 0.17, 0.28], '#F3C7CE'],
        [x - 0.28, y + 2.22, z + 0.16, [0.28, 0.14, 0.24], '#6B9158'],
        [x + 0.94, y + 2.16, z - 0.14, [0.24, 0.13, 0.22], '#749A5E']
      ];
      for (let fl = 0; fl < sprays.length; fl++) {
        const [fx, fy, fz, sc, col] = sprays[fl];
        baker.orb([fx, fy, fz], sc, col, 'solid', fl * 1.45);
      }
      // 三枚朱绳悬垂的素木祈岁木牍（倒角牌首 + 墨书牌面 + 朱色系绳与流苏）
      for (let t = 0; t < 3; t++) {
        const px = x + 0.46 + t * 0.34;
        const pz = z + 0.05 + t * 0.045;
        const py = y + 1.92 + t * 0.095;
        const tm = makeMiniMesh(b => {
          // 朱红系绳与牌孔绳结
          b.beam([0, 0.02, 0], [0, -0.20, 0], 0.009, '#AD3F38', 0.009, 4);
          b.orb([0, -0.21, 0], [0.022, 0.020, 0.022], '#BD473F', 'solid', t);
          // 桃木牌身 + 削肩牌额
          b.block([0, -0.36, 0], [0.115, 0.25, 0.022], t % 2 ? '#D7C094' : '#C9AD7F');
          b.beam([0, -0.24, 0], [0, -0.20, 0], 0.056, t % 2 ? '#D7C094' : '#C9AD7F', 0.036, 4);
          // 牌面两道竖排墨书笔意 + 底部朱穗
          b.block([-0.018, -0.36, 0.013], [0.014, 0.16, 0.006], '#594230');
          b.block([0.018, -0.36, 0.013], [0.014, 0.14, 0.006], '#594230');
          b.beam([0, -0.49, 0], [0, -0.58, 0], 0.007, '#B2433B', 0.018, 5);
        }, [px, py, pz], 'easter-tally-' + t);
        if (tm) animActors.tallies.push({ mesh: tm, phase: t * 1.1 });
      }
      blockers.push({ x, z, hw: 0.35, hd: 0.35, minY: y, maxY: y + 2.2, rot: 0, source: 'easter-' + spec.id });
    } else if (spec.id === 'moon-white-stag') {
      // 林间偃盖青松、青苔碎石与露水旁安详立望的雕塑级雪白灵鹿
      baker.orb([x + 0.95, y + 0.16, z + 0.4], [0.46, 0.22, 0.42], '#899282', 'solid', 3.2);
      baker.orb([x + 0.60, y + 0.08, z + 0.64], [0.24, 0.12, 0.22], '#6E7F5E', 'solid', 4.6);
      // 苍古斜出青松干与层叠松针云片（横斜覆于苔石与白鹿侧上方，零额外静态 draw call）
      baker.beam([x + 1.24, y - 0.06, z + 0.52], [x + 1.08, y + 1.15, z + 0.42], 0.135, '#564336', 0.105, 7, 'solid');
      baker.beam([x + 1.08, y + 1.12, z + 0.42], [x + 0.86, y + 2.18, z + 0.26], 0.102, '#5E493B', 0.068, 7, 'solid');
      baker.beam([x + 0.90, y + 2.06, z + 0.28], [x + 0.24, y + 1.98, z + 0.08], 0.058, '#634D3E', 0.032, 6, 'solid');
      baker.beam([x + 0.72, y + 2.02, z + 0.23], [x + 0.88, y + 1.92, z + 0.62], 0.040, '#634D3E', 0.022, 5, 'solid');
      baker.beam([x + 0.86, y + 2.16, z + 0.26], [x + 1.26, y + 2.38, z + 0.46], 0.046, '#634D3E', 0.024, 5, 'solid');
      baker.orb([x + 0.26, y + 2.06, z + 0.08], [0.48, 0.13, 0.42], '#38604D', 'solid', 1.2);
      baker.orb([x + 0.66, y + 2.16, z + 0.24], [0.54, 0.15, 0.46], '#2F5344', 'solid', 2.5);
      baker.orb([x + 0.88, y + 1.98, z + 0.60], [0.42, 0.12, 0.38], '#436C57', 'solid', 3.8);
      baker.orb([x + 1.18, y + 2.44, z + 0.44], [0.52, 0.15, 0.45], '#355B49', 'solid', 5.1);

      animActors.stagOriginY = y;
      animActors.stagGroup = makeMiniMesh(b => {
        // 1. 流线圆浑雪白鹿躯（臀 -> 后胯 -> 收腹 -> 深胸 -> 前膺）
        bakeLoft(b, [
          [0, 0.77, -0.44, 0.052, 0.060],
          [0, 0.78, -0.30, 0.145, 0.145],
          [0, 0.76, -0.06, 0.152, 0.152],
          [0, 0.79, 0.18, 0.168, 0.178],
          [0, 0.82, 0.35, 0.142, 0.162],
          [0, 0.83, 0.45, 0.065, 0.075]
        ], 8, ['#F2EFE7', '#F6F4EC', '#EFECE3', '#F5F3EB', '#F7F5EE'], '#DFDCD0');

        // 2. 轻翘雪白短鹿尾
        b.beam([0, 0.80, -0.42], [0, 0.89, -0.53], 0.038, '#FAF9F4', 0.014, 5);

        // 3. 纤细修长四肢（前肢腕节 + 后肢飞节折角 + 黛色偶蹄）
        for (const lx of [-0.105, 0.105]) {
          b.beam([lx, 0.42, 0.31], [lx, 0.77, 0.30], 0.028, '#EDEAE0', 0.056, 6);
          b.beam([lx, 0.05, 0.32], [lx, 0.43, 0.31], 0.017, '#E4E0D4', 0.027, 5);
          b.beam([lx, 0.0, 0.33], [lx, 0.055, 0.32], 0.024, '#3A3632', 0.018, 5);
        }
        for (const lx of [-0.115, 0.115]) {
          b.beam([lx, 0.44, -0.34], [lx, 0.76, -0.27], 0.028, '#EBE8DE', 0.064, 6);
          b.beam([lx, 0.05, -0.29], [lx, 0.45, -0.34], 0.017, '#E3DFD3', 0.027, 5);
          b.beam([lx, 0.0, -0.28], [lx, 0.055, -0.29], 0.024, '#3A3632', 0.018, 5);
        }

        // 4. 优雅微拱修长鹿颈
        b.beam([0, 0.80, 0.34], [0, 1.01, 0.42], 0.104, '#F1EEE5', 0.076, 7);
        b.beam([0, 0.99, 0.415], [0, 1.18, 0.465], 0.076, '#F7F5EE', 0.058, 7);
      }, [x, y, z], 'easter-white-stag-body');
      if (animActors.stagGroup) animActors.stagGroup.rotation.y = rot;

      const headPivot = [x + Math.sin(rot) * 0.465, y + 1.18, z + Math.cos(rot) * 0.465];
      const stagHeadPivot = new THREE.Group();
      stagHeadPivot.name = 'easter-white-stag-head';
      stagHeadPivot.position.set(headPivot[0], headPivot[1], headPivot[2]);
      stagHeadPivot.rotation.y = rot;
      stagHeadPivot.userData.baseX = headPivot[0];
      stagHeadPivot.userData.baseZ = headPivot[2];
      stagHeadPivot.userData.baseRot = rot;
      group.add(stagHeadPivot);
      animActors.stagHeadGroup = stagHeadPivot;

      makeMiniMesh(b => {
        // 秀逸锥形鹿首 + 湿润墨鼻 + 温润黑眸
        bakeLoft(b, [
          [0, 0.030, -0.04, 0.054, 0.058],
          [0, 0.045, 0.05, 0.072, 0.068],
          [0, 0.022, 0.15, 0.046, 0.044],
          [0, 0.008, 0.24, 0.026, 0.025]
        ], 7, ['#F6F4EC', '#F9F7F1', '#EFECE2'], '#E4E0D5');
        b.peach([0, 0.012, 0.250], [0.022, 0.018, 0.020], '#38302E');
        for (const sd of [-1, 1]) {
          b.peach([sd * 0.064, 0.052, 0.082], [0.012, 0.013, 0.016], '#241F1D');
          // 玉色四叉灵角（眉叉 + 冰叉 + 后灵叉 + 冠顶主叉）
          b.beam([sd * 0.038, 0.088, 0.01], [sd * 0.11, 0.22, -0.04], 0.019, '#DFD0B2', 0.015, 5);
          b.beam([sd * 0.11, 0.22, -0.04], [sd * 0.17, 0.35, -0.05], 0.015, '#E7D9BD', 0.012, 5);
          b.beam([sd * 0.17, 0.35, -0.05], [sd * 0.14, 0.47, 0.01], 0.012, '#F1E6CE', 0.005, 5); // 第1叉（冠顶主尖）
          b.beam([sd * 0.068, 0.14, -0.01], [sd * 0.095, 0.21, 0.09], 0.012, '#EADCC2', 0.005, 4); // 第2叉（前探眉叉）
          b.beam([sd * 0.125, 0.25, -0.04], [sd * 0.21, 0.33, 0.04], 0.011, '#EFE2C9', 0.005, 4); // 第3叉（斜展冰叉）
          b.beam([sd * 0.16, 0.34, -0.05], [sd * 0.22, 0.45, -0.08], 0.010, '#F3E8D2', 0.005, 4); // 第4叉（高耸后叉）
        }
      }, [0, 0, 0], 'easter-white-stag-skull', stagHeadPivot);

      // 左右独立粉廓灵耳（靠近或互动时灵敏竖耳微动）
      for (const sd of [-1, 1]) {
        const earMesh = makeMiniMesh(b => {
          b.beam([0, 0, 0], [sd * 0.085, 0.095, -0.025], 0.018, '#F4F1E8', 0.009, 5);
          b.beam([sd * 0.008, 0.010, 0.008], [sd * 0.072, 0.082, -0.014], 0.012, '#E9C8C4', 0.005, 4);
        }, [sd * 0.052, 0.078, 0.005], sd < 0 ? 'easter-stag-ear-l' : 'easter-stag-ear-r', stagHeadPivot);
        if (sd < 0) animActors.stagEarL = earMesh;
        else animActors.stagEarR = earMesh;
      }

      // 松针清露微粒（单批次 6 颗清透松露，平时隐藏 0 draw，受惊或回礼时自松梢凝坠苔石）
      const dewAnchors = [
        { x: x + 0.86, startY: y + 1.93, landY: y + 0.36, z: z + 0.54, stone: true },
        { x: x + 0.32, startY: y + 2.00, landY: y + 0.05, z: z + 0.10, stone: false },
        { x: x + 0.96, startY: y + 1.92, landY: y + 0.38, z: z + 0.38, stone: true },
        { x: x + 0.60, startY: y + 2.08, landY: y + 0.15, z: z + 0.62, stone: false },
        { x: x + 0.22, startY: y + 1.99, landY: y + 0.04, z: z + 0.04, stone: false },
        { x: x + 0.74, startY: y + 2.07, landY: y + 0.32, z: z + 0.34, stone: false }
      ];
      const dewInst = new THREE.InstancedMesh(buildPineDewGeometry(), dewMat, dewAnchors.length);
      dewInst.name = 'easter-stag-pine-dew';
      dewInst.visible = false;
      dewInst.frustumCulled = false;
      dewInst.renderOrder = 4;
      dewInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let d = 0; d < dewAnchors.length; d++) {
        dewInst.setMatrixAt(d, zeroM);
        animActors.stagDewDrops.push({
          ...dewAnchors[d],
          active: false,
          delay: 0,
          age: 0,
          splashAge: 0,
          splashed: false
        });
      }
      dewInst.instanceMatrix.needsUpdate = true;
      group.add(dewInst);
      animActors.stagDewMesh = dewInst;

      blockers.push({ x, z, hw: 0.45, hd: 0.55, minY: y, maxY: y + 1.5, rot, source: 'easter-' + spec.id });
    }

    // 淡金色微光小萤石印记（方便昼夜远眺寻幽，暮夜更添灵气）
    const glowRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 14), glowMat);
    glowRing.rotation.x = -Math.PI * 0.5;
    glowRing.position.set(x, y + 0.06, z);
    group.add(glowRing);
    animActors.shimmerRings.push({ mesh: glowRing, baseY: y + 0.06, phase: sites.length * 0.9 });

    const height = spec.id === 'moon-white-stag' ? 1.1 : spec.id === 'peach-wind-tallies' ? 1.6 : 0.65;
    sites.push({ ...spec, x, y, z, height, cooldown: 0 });
    targets.push({ id: spec.id, x, y: y + height, z, range: 6.5 });
  }

  const staticMesh = baker.finish('solid', staticMat);
  baker.dispose();
  if (staticMesh) {
    staticMesh.name = 'easter-eggs-static';
    group.add(staticMesh);
  }

  let noteEl = null;
  let boundSound = null;
  let noteTimer = 0;
  let noteStep = 0;
  let simElapsed = 0;
  let hasSimInit = false;
  let guqinGrace = null;
  const dewTmpObj = new THREE.Object3D();

  function earPulse(t, center, width) {
    const u = (t - center) / width;
    return Math.exp(-u * u);
  }

  function triggerStagDewAndEars(dropCount = 6, flutterDur = 2.4, soundRef = null) {
    animActors.stagEarFlutter = Math.max(animActors.stagEarFlutter, flutterDur);
    animActors.stagEarFlutterTotal = Math.max(animActors.stagEarFlutter, flutterDur);
    if (soundRef) animActors.stagSound = soundRef;
    if (!animActors.stagDewDrops.length || !animActors.stagDewMesh) return;
    const n = Math.min(dropCount, animActors.stagDewDrops.length);
    for (let i = 0; i < n; i++) {
      const d = animActors.stagDewDrops[i];
      d.active = true;
      d.delay = i * 0.12;
      d.age = 0;
      d.splashAge = 0;
      d.splashed = false;
    }
    animActors.stagDewActive = n;
    animActors.stagDewShowers++;
    animActors.stagDewMesh.visible = true;
  }
  const GUQIN_PHRASES = [
    [0, 2], [2, 4], [4, 5], [3, 4],
    [2, 0], [1, 3], [4, 2], [0, 5]
  ];
  const discovered = new Set();
  const interacted = new Set();
  let disposed = false;

  function triggerSite(site, sound, doc) {
    if (!site) return null;
    site.cooldown = site.soundKind === 'guqin' ? 0.65 : 3.2;
    interacted.add(site.id);
    discovered.add(site.id);
    noteTimer = 4.8;
    if (site.id === 'moon-white-stag') {
      animActors.stagGreetTimer = 2.8;
      triggerStagDewAndEars(6, 2.4, sound || boundSound);
    } else if (site.id === 'floating-wine-cup') {
      animActors.cupNudge = 1.8;
    }
    const note = noteEl || doc?.getElementById?.('mystery-note');
    if (note) {
      note.textContent = site.line;
      note.classList.add('show');
    }
    try {
      sound?.unlock?.();
      if (site.soundKind === 'guqin') {
        const pair = GUQIN_PHRASES[noteStep % GUQIN_PHRASES.length];
        noteStep++;
        sound?.guqinPluck?.(site.x, site.z, pair[0]);
        guqinGrace = { delay: 0.045, x: site.x, z: site.z, note: pair[1], sound };
      } else if (site.soundKind === 'bell') {
        sound?.bell?.(site.x, site.z);
      } else if (site.soundKind === 'wood' || site.soundKind === 'jar') {
        sound?.wood?.(site.x, site.z);
      } else if (site.soundKind === 'stag') {
        (sound?.stagCall || sound?.bell)?.call(sound, site.x, site.z);
      } else if (site.soundKind === 'water') {
        (sound?.waterCup || sound?.gurgle)?.call(sound, site.x, site.z);
      } else {
        sound?.wood?.(site.x, site.z);
      }
    } catch (_) { /* 静默浏览器环境同样完成视觉响应 */ }
    return { id: site.id, name: site.name, line: site.line };
  }

  function pickEggTarget(camera, playerState, cfg = {}) {
    if (disposed || !playerState) return null;
    const st = playerState;
    const third = st.view === 'third';
    const eyeX = third ? st.x : camera.position.x;
    const eyeY = third ? st.y + (st.eyeHeight || 1.62) : camera.position.y;
    const eyeZ = third ? st.z : camera.position.z;
    const cp = Math.cos(st.pitch || 0);
    const fx = -Math.sin(st.yaw || 0) * cp;
    const fy = Math.sin(st.pitch || 0);
    const fz = -Math.cos(st.yaw || 0) * cp;
    let best = null;
    for (const s of sites) {
      if (s.cooldown > 0) continue;
      const distXZ = Math.hypot(s.x - st.x, s.z - st.z);
      if (distXZ > 4.2) continue;
      const ty = s.y + s.height;
      const dx = s.x - eyeX, dy = ty - eyeY, dz = s.z - eyeZ;
      const dist = Math.hypot(dx, dy, dz);
      const dot = (dx * fx + dy * fy + dz * fz) / (dist || 1);
      if (distXZ > 2.3 && dot < 0.72) continue;
      const score = dist + (1 - dot) * (cfg.alignBias || 2.5);
      if (!best || score < best.score) {
        best = {
          kind: 'mystery',
          key: 'egg:' + s.id,
          id: s.id,
          isEasterEgg: true,
          name: s.name,
          label: s.name,
          prompt: s.action + ' · ' + s.name,
          x: s.x,
          y: ty,
          z: s.z,
          dist,
          dot,
          score
        };
      }
    }
    return best;
  }

  function bind({ mysteries, sound, player, doc } = {}) {
    noteEl = doc?.getElementById?.('mystery-note') || null;
    if (sound) boundSound = sound;
    if (!mysteries || mysteries._easterEggsBound) return;
    mysteries._easterEggsBound = true;
    const prevPick = mysteries.pickTarget;
    const prevInteract = mysteries.interact;
    const prevHide = mysteries.hide;

    mysteries.pickTarget = function (camera, cfg) {
      const a = prevPick?.(camera, cfg) || null;
      const b = pickEggTarget(camera, player?.state, cfg);
      if (!a) return b;
      if (!b) return a;
      return b.score < a.score ? b : a;
    };

    mysteries.interact = function (target) {
      if (target?.isEasterEgg) {
        const s = sites.find(item => item.id === target.id);
        return triggerSite(s, sound, doc);
      }
      return prevInteract?.(target) || null;
    };

    mysteries.hide = function () {
      noteTimer = 0;
      prevHide?.();
    };
  }

  function interactById(id, sound, doc) {
    const s = sites.find(item => item.id === id);
    return triggerSite(s, sound, doc);
  }

  function update(dt, elapsed = 0, sky = null, playerState = null) {
    if (disposed) return;
    const rawDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const step = Math.min(0.05, rawDt);
    if (!hasSimInit) {
      simElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      hasSimInit = true;
    } else if (step > 0) {
      simElapsed += step;
    }
    if (step <= 0 && hasSimInit) return;

    for (const s of sites) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - step);
    }
    if (noteTimer > 0) {
      noteTimer -= step;
      if (noteTimer <= 0 && noteEl) noteEl.classList.remove('show');
    }
    if (guqinGrace && step > 0) {
      guqinGrace.delay -= step;
      if (guqinGrace.delay <= 0) {
        const g = guqinGrace;
        guqinGrace = null;
        try { g.sound?.guqinPluck?.(g.x, g.z, g.note); } catch (_) { /* noop */ }
      }
    }

    const tSim = simElapsed;

    // 曲水漆耳杯顺水漂流缓旋（互动临流时轻推羽觞顺水滑转）
    if (animActors.cupGroup) {
      if (animActors.cupNudge > 0) animActors.cupNudge = Math.max(0, animActors.cupNudge - step);
      animActors.cupDriftAngle += step * (0.42 + animActors.cupNudge * 1.55);
      const driftR = 0.31 + Math.sin(tSim * 0.9) * 0.04;
      animActors.cupGroup.position.set(
        animActors.cupBaseX + Math.cos(animActors.cupDriftAngle) * driftR,
        animActors.cupOriginY + Math.sin(tSim * 2.1) * 0.011 - animActors.cupNudge * 0.004,
        animActors.cupBaseZ + Math.sin(animActors.cupDriftAngle) * driftR
      );
      animActors.cupGroup.rotation.y = -animActors.cupDriftAngle + tSim * 0.45;
      animActors.cupGroup.rotation.z = Math.sin(tSim * 1.7) * 0.05 + animActors.cupNudge * 0.04;
    }

    // 桃枝木牌随风轻摆
    const windS = Math.min(1.6, 0.35 + (sky?.wind ?? 0.3) * 0.9);
    for (const t of animActors.tallies) {
      t.mesh.rotation.z = Math.sin(tSim * 2.2 + t.phase) * 0.14 * windS;
      t.mesh.rotation.x = Math.cos(tSim * 1.6 + t.phase) * 0.08 * windS;
    }

    // 酒香漂浮微粒
    for (const m of animActors.aromaMotes) {
      const cy = ((tSim * 0.35 + m.phase) % 1);
      m.mesh.position.set(
        m.bx + Math.sin(tSim * 1.4 + m.phase * 2) * 0.14,
        m.by + cy * 0.68,
        m.bz + Math.cos(tSim * 1.2 + m.phase * 2) * 0.14
      );
      const sc = Math.sin(cy * Math.PI);
      m.mesh.scale.setScalar(0.35 + sc * 0.85);
    }

    // 幽林白鹿温润呼吸、受惊/回礼多拍灵耳微颤与松针落露
    if (animActors.stagHeadGroup) {
      if (animActors.stagGreetTimer > 0) {
        animActors.stagGreetTimer = Math.max(0, animActors.stagGreetTimer - step);
      }
      if (animActors.stagEarFlutter > 0) {
        animActors.stagEarFlutter = Math.max(0, animActors.stagEarFlutter - step);
      }
      if (animActors.stagStartleLift > 0) {
        animActors.stagStartleLift = Math.max(0, animActors.stagStartleLift - step * 1.4);
      }
      if (animActors.stagProximityCooldown > 0) {
        animActors.stagProximityCooldown = Math.max(0, animActors.stagProximityCooldown - step);
      }
      if (animActors.stagStartleCooldown > 0) {
        animActors.stagStartleCooldown = Math.max(0, animActors.stagStartleCooldown - step);
      }

      const hg = animActors.stagHeadGroup;
      let aim = 0;
      let closePerk = 0;
      if (playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z)) {
        const dStag = Math.hypot(playerState.x - hg.userData.baseX, playerState.z - hg.userData.baseZ);
        const pSpd = Math.hypot(playerState.vx || 0, playerState.vz || 0);
        const isRunning = Boolean(playerState.sprinting) || pSpd > 5.2;
        if (dStag < 10) {
          const desired = Math.atan2(playerState.x - hg.userData.baseX, playerState.z - hg.userData.baseZ) - hg.userData.baseRot;
          aim = Math.max(-0.65, Math.min(0.65, Math.atan2(Math.sin(desired), Math.cos(desired))));
        }
        if (dStag < 4.5) {
          closePerk = Math.max(0, Math.min(1, (4.5 - dStag) / 2.2));
        }
        if (step > 0 && dStag < 6.8 && isRunning && animActors.stagStartleCooldown <= 0) {
          animActors.stagStartleCooldown = 6.5;
          animActors.stagProximityCooldown = Math.max(animActors.stagProximityCooldown, 8.0);
          animActors.stagStartleLift = 1.0;
          triggerStagDewAndEars(6, 2.1, boundSound);
        } else if (step > 0 && dStag < 3.9 && animActors.stagProximityCooldown <= 0) {
          animActors.stagProximityCooldown = 10.5;
          triggerStagDewAndEars(4, 1.75, boundSound);
        }
      }

      const greetProgress = animActors.stagGreetTimer > 0 ? (2.8 - animActors.stagGreetTimer) / 2.8 : 0;
      const greetBow = animActors.stagGreetTimer > 0
        ? Math.pow(Math.sin(greetProgress * Math.PI), 0.85) * (0.72 + 0.28 * Math.sin(greetProgress * Math.PI * 3))
        : 0;
      const startleAlert = Math.sin(Math.min(1, animActors.stagStartleLift) * Math.PI * 0.5);
      const bowPitch = greetBow * 0.42 + closePerk * 0.12 - startleAlert * 0.14;
      hg.rotation.y = hg.userData.baseRot + aim * 0.72 + Math.sin(tSim * 0.85) * 0.10 * (1 - greetBow * 0.6);
      hg.rotation.x = 0.05 + bowPitch + Math.sin(tSim * 1.4) * 0.06;
      hg.position.y = animActors.stagOriginY + 1.18 + Math.sin(tSim * 1.6) * 0.012 - bowPitch * 0.06 + startleAlert * 0.028;

      const earAlert = Math.max(closePerk, greetBow, startleAlert);
      let flickL = 0;
      let flickR = 0;
      if (animActors.stagEarFlutter > 0) {
        const eAge = Math.max(0, animActors.stagEarFlutterTotal - animActors.stagEarFlutter);
        flickL = 0.36 * earPulse(eAge, 0.07, 0.052)
          - 0.16 * earPulse(eAge, 0.16, 0.044)
          + 0.30 * earPulse(eAge, 0.27, 0.058)
          + 0.18 * earPulse(eAge, 1.12, 0.068);
        flickR = 0.34 * earPulse(eAge, 0.13, 0.054)
          + 0.32 * earPulse(eAge, 0.34, 0.062)
          - 0.14 * earPulse(eAge, 0.45, 0.048)
          + 0.20 * earPulse(eAge, 1.28, 0.072);
      } else {
        const idleTwitch = Math.sin(tSim * 5.6) > 0.92 ? 0.13 : 0;
        flickL = idleTwitch;
        flickR = idleTwitch * 0.55;
      }
      if (animActors.stagEarL) {
        animActors.stagEarL.rotation.set(
          earAlert * 0.22 + flickL * 0.28,
          earAlert * 0.28 + flickL * 0.34,
          -0.18 + earAlert * 0.16 + flickL
        );
      }
      if (animActors.stagEarR) {
        animActors.stagEarR.rotation.set(
          earAlert * 0.22 + flickR * 0.28,
          -earAlert * 0.28 - flickR * 0.34,
          0.18 - earAlert * 0.16 - flickR
        );
      }

      // 松针落露：凝珠微颤 -> 缓坠青苔石 -> 水花轻散并触发清露轻叩声
      if (animActors.stagDewMesh && animActors.stagDewDrops.length) {
        const twId = sky?.timeId;
        if (twId === 'night') dewLightCol.set('#A8C8D4');
        else if (twId === 'dusk' || twId === 'dawn') dewLightCol.set('#F2DEC8');
        else dewLightCol.set('#E6F5F0');
        dewMat.color.copy(dewLightCol);

        const windX = Number.isFinite(sky?.windX) ? sky.windX : 0.12;
        const windZ = Number.isFinite(sky?.windZ) ? sky.windZ : 0.06;
        let liveDew = 0;
        for (let i = 0; i < animActors.stagDewDrops.length; i++) {
          const d = animActors.stagDewDrops[i];
          if (!d.active) {
            dewTmpObj.position.set(d.x, d.startY, d.z);
            dewTmpObj.scale.set(0, 0, 0);
            dewTmpObj.updateMatrix();
            animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
            continue;
          }
          if (d.delay > 0) {
            d.delay -= step;
            dewTmpObj.position.set(d.x, d.startY, d.z);
            dewTmpObj.scale.set(0, 0, 0);
            dewTmpObj.updateMatrix();
            animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
            liveDew++;
            continue;
          }
          d.age += step;
          if (d.age < 0.14) {
            // 松针尖凝结微颤阶段
            const swell = 0.35 + (d.age / 0.14) * 0.70;
            dewTmpObj.position.set(
              d.x + Math.sin(d.age * 36 + i) * 0.004,
              d.startY - (d.age / 0.14) * 0.018,
              d.z
            );
            dewTmpObj.rotation.set(0, 0, 0);
            dewTmpObj.scale.set(swell, swell, swell);
            dewTmpObj.updateMatrix();
            animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
            liveDew++;
          } else {
            const fallT = d.age - 0.14;
            const curY = d.startY - 0.018 - (0.34 * fallT + 2.45 * fallT * fallT);
            const driftX = d.x + windX * 0.055 * fallT;
            const driftZ = d.z + windZ * 0.055 * fallT;
            if (curY > d.landY && !d.splashed) {
              const spd = 0.34 + 4.9 * fallT;
              const sy = 1.0 + Math.min(0.85, spd * 0.18);
              const sxz = 1.0 - Math.min(0.22, spd * 0.05);
              dewTmpObj.position.set(driftX, curY, driftZ);
              dewTmpObj.rotation.set(0, 0, 0);
              dewTmpObj.scale.set(sxz, sy, sxz);
              dewTmpObj.updateMatrix();
              animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
              liveDew++;
            } else {
              if (!d.splashed) {
                d.splashed = true;
                d.splashAge = 0;
                if (d.stone) {
                  const sfx = animActors.stagSound || boundSound;
                  try { sfx?.dewDrop?.(driftX, driftZ); } catch (_) { /* noop */ }
                }
              }
              d.splashAge += step;
              if (d.splashAge < 0.15) {
                const u = d.splashAge / 0.15;
                const sxz = 1.0 + u * 1.95;
                const sy = Math.max(0.05, 0.42 * (1 - u));
                dewTmpObj.position.set(driftX, d.landY + 0.008, driftZ);
                dewTmpObj.rotation.set(0, 0, 0);
                dewTmpObj.scale.set(sxz, sy, sxz);
                dewTmpObj.updateMatrix();
                animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
                liveDew++;
              } else {
                d.active = false;
                dewTmpObj.position.set(d.x, d.startY, d.z);
                dewTmpObj.scale.set(0, 0, 0);
                dewTmpObj.updateMatrix();
                animActors.stagDewMesh.setMatrixAt(i, dewTmpObj.matrix);
              }
            }
          }
        }
        animActors.stagDewActive = liveDew;
        animActors.stagDewMesh.visible = liveDew > 0;
        animActors.stagDewMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // 微光圈昼隐夜现，远距收隐节省批次数
    const tw = sky?.timeId;
    const isSoftLight = tw === 'night' || tw === 'dusk' || tw === 'dawn';
    const hasPlayer = Boolean(playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.z));
    glowMat.opacity = isSoftLight ? 0.42 + Math.sin(tSim * 2.6) * 0.14 : 0.16;
    for (const r of animActors.shimmerRings) {
      const near = !hasPlayer || Math.hypot(playerState.x - r.mesh.position.x, playerState.z - r.mesh.position.z) <= 65;
      r.mesh.visible = near;
      if (near) r.mesh.position.y = r.baseY + Math.sin(tSim * 2.0 + r.phase) * 0.015;
    }
  }

  function getStats() {
    return {
      count: sites.length,
      sites: sites.map(s => ({ id: s.id, name: s.name, x: s.x, y: s.y, z: s.z })),
      interacted: [...interacted],
      discovered: [...discovered],
      stagEarFlutter: Math.round(animActors.stagEarFlutter * 1000) / 1000,
      stagDewActive: animActors.stagDewActive,
      stagDewShowers: animActors.stagDewShowers,
      disposed
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    staticMat.dispose();
    dynMat.dispose();
    glowMat.dispose();
    dewMat.dispose();
    if (animActors.stagDewMesh) {
      animActors.stagDewMesh.visible = false;
      animActors.stagDewMesh.dispose?.();
    }
    for (const r of animActors.shimmerRings) r.mesh.geometry?.dispose?.();
    group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    group.removeFromParent();
  }

  return { group, sites, targets, blockers, bind, interactById, update, getStats, dispose };
}
