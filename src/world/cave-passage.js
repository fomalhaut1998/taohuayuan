import * as THREE from 'three';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth01(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function hash2(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * 狭长曲折的山洞岩廊（「初极狭，才通人。复行数十步，豁然开朗」）：
 * 沿已有 cliff.slit 轴线向外延至 s = +15.5m（初极狭外口），向内延至 s = -25.0m（豁然开朗谷口），
 * 全长约 40.5 米（约三十步），带自然 S 形弯折、分层岩石护壁、顶壁岩肋、湿润石板与天光裂隙。
 */
export function createCavePassage(options = {}) {
  const { cliff, field, world, scatter } = options;
  const slit = cliff?.slit;
  const group = new THREE.Group();
  group.name = 'cave-passage';

  if (!slit || !Number.isFinite(slit.x) || !Number.isFinite(slit.z)) {
    return {
      group,
      vinesMesh: null,
      dripsMesh: null,
      blockers: [],
      layout: null,
      update() {},
      getStats: () => ({
        built: false,
        lengthMeters: 0,
        minWidthMeters: 0,
        maxWidthMeters: 0,
        fupicunHooked: false,
        vinesMesh: null,
        dripsMesh: null,
        simTime: 0
      }),
      dispose() { group.removeFromParent(); }
    };
  }

  const outX = Math.cos(slit.angle || 0);
  const outZ = Math.sin(slit.angle || 0);
  // 与 cliff.js 保持一致：tx/tz 为横向切线，ux/uz 为朝洞外方向
  const ux = outX;
  const uz = outZ;
  const tx = -uz;
  const tz = ux;

  const OUTER_S = 15.5;
  const INNER_S = -25.0;
  const TOTAL_LEN = OUTER_S - INNER_S; // 40.5m (~29 paces)

  // 中线轻微 S 形曲折：在核心段（[-6, +7.5]）保持贴近 0，出入两侧温和偏转遮住直视视线
  function centerLat(s) {
    let offset = 0;
    if (s > 7.5) {
      const u = smooth01((s - 7.5) / (OUTER_S - 7.5));
      offset -= 0.44 * u;
    } else if (s < -6.0) {
      const bendIn = Math.sin(smooth01((-6.0 - s) / 11.5) * Math.PI * 0.5) * 0.72;
      const flareOut = smooth01((-17.5 - s) / 7.5) * 0.46;
      offset += bendIn - flareOut;
    }
    return offset;
  }

  // 半宽曲线：外段「初极狭，才通人」(0.97~1.03m)，中段曲折通畅(1.03~1.17m)，末端「豁然开朗」(->2.68m)
  function halfWidth(s) {
    if (s >= 7.5) {
      const u = smooth01((s - 7.5) / (OUTER_S - 7.5));
      return 1.03 - u * 0.06; // 2.06m -> 1.94m total width
    }
    if (s >= -17.0) {
      const u = smooth01((7.5 - s) / 24.5);
      return 1.03 + u * 0.14; // 2.06m -> 2.34m
    }
    const flare = smooth01((-17.0 - s) / 8.0);
    return 1.17 + flare * flare * 1.51; // 2.34m -> 5.36m wide mouth
  }

  // 拱顶高度：在核心穿崖段收在 gate-liner 拱顶(2.70m)之下以消除碎岩穿顶，向两端高敞抬升
  function vaultHeight(s) {
    if (s >= 7.5) {
      const u = smooth01((s - 7.5) / (OUTER_S - 7.5));
      return 2.58 + u * 1.48;
    }
    if (s >= -7.5) {
      return 2.56 + Math.cos((s / 7.5) * Math.PI * 0.5) * -0.04;
    }
    if (s >= -17.5) {
      const u = smooth01((-7.5 - s) / 10.0);
      return 2.58 + u * 0.68;
    }
    const flare = smooth01((-17.5 - s) / 7.5);
    return 3.26 + flare * 2.15;
  }

  function toWorld(s, lat, localY) {
    const gx = slit.x + ux * s + tx * lat;
    const gz = slit.z + uz * s + tz * lat;
    const gY = field?.sample ? field.sample(gx, gz) : (slit.ground ?? 2.0);
    return [gx, gY + localY, gz];
  }

  function sampleFloorBaseY(s, cl, hw) {
    if (!field?.sample) return slit.ground ?? 2.0;
    let maxG = -Infinity;
    for (const ds of [-0.9, 0, 0.9]) {
      const ss = clamp(s + ds, INNER_S, OUTER_S);
      for (const dl of [-(hw + 0.28), 0, hw + 0.28]) {
        const gx = slit.x + ux * ss + tx * (cl + dl);
        const gz = slit.z + uz * ss + tz * (cl + dl);
        const gy = field.sample(gx, gz);
        if (gy > maxG) maxG = gy;
      }
    }
    const endFade = smooth01(Math.min((OUTER_S - s) / 3.2, (s - INNER_S) / 3.2));
    return maxG + 0.025 + 0.145 * endFade;
  }

  function floorWorldPt(s, lat, baseY, crown = 0) {
    const gx = slit.x + ux * s + tx * lat;
    const gz = slit.z + uz * s + tz * lat;
    return [gx, baseY + crown, gz];
  }

  const pos = [];
  const col = [];
  const meta = [];
  const cRockLight = new THREE.Color('#959B8E');
  const cRockMid = new THREE.Color('#777D71');
  const cRockDark = new THREE.Color('#474C43');
  const cMoss = new THREE.Color('#5A6D49');
  const cFloorStone = new THREE.Color('#807D71');
  const cFloorWet = new THREE.Color('#565B54');
  const tmpC = new THREE.Color();
  const defaultMeta = [0.55, 0.0];
  const floorMeta = [0.0, 1.0];

  function pushTri(a, ca, b, cb, c, cc, ma = defaultMeta, mb = ma, mc = ma) {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    meta.push(ma[0], ma[1], mb[0], mb[1], mc[0], mc[1]);
  }

  function pushQuad(a, ca, b, cb, c, cc, d, cd, ma = defaultMeta, mb = ma, mc = ma, md = ma) {
    pushTri(a, ca, b, cb, c, cc, ma, mb, mc);
    pushTri(a, ca, c, cc, d, cd, ma, mc, md);
  }

  function rockTint(s, fracHeight, noiseVal, outColor) {
    const endProx = Math.max(smooth01((s - 8.5) / 7.0), smooth01((-16.5 - s) / 8.5));
    const coreDark = 0.26 + 0.74 * endProx;
    outColor.copy(cRockDark).lerp(cRockMid, 0.35 + 0.55 * endProx);
    outColor.lerp(cRockLight, clamp(noiseVal * 0.55 + fracHeight * 0.22, 0, 1) * endProx);
    if (fracHeight < 0.36 && endProx > 0.25 && noiseVal > 0.42) {
      outColor.lerp(cMoss, (noiseVal - 0.35) * endProx * 0.72);
    }
    outColor.multiplyScalar(0.74 + 0.32 * coreDark);
    return outColor;
  }

  // 1. 洞壁、岩肋拱顶与外侧渐落山脊护壳：分别覆盖外延段 [+7.2..+15.5] 与内延段 [-25.0..-7.2]
  // 在 [-7.2..+7.2] 核心穿崖段保留 cliff.js 原装 gate-liner，同时以内收岩肋衔接不露接缝
  const slices = 74;
  const profilePoints = [];

  for (let i = 0; i <= slices; i++) {
    const u = i / slices;
    const s = INNER_S + u * TOTAL_LEN;
    const cl = centerLat(s);
    const hw = halfWidth(s);
    const vh = vaultHeight(s);
    // 外壁山肩高度：越靠近 cliff 本体（|s| 小）越高，向两端自然伏落融入平地
    const nearCore = clamp(1 - Math.max(0, Math.abs(s) - 7.0) / 19.5, 0, 1);
    const outerShoulderH = vh + 0.9 + nearCore * nearCore * 5.2 + hash2(i, 3) * 0.55;
    const shoulderSpan = hw + 2.2 + nearCore * 3.8;

    const ring = [];
    // 环截面点：左下地脚 -> 左内腰 -> 左内拱肩 -> 拱顶 -> 右内拱肩 -> 右内腰 -> 右下地脚 -> 右外肩 -> 右外坡脚 -> 左外坡脚 -> 左外肩
    // 加上适度凹凸岩面噪声
    const jL1 = (hash2(s, 11) - 0.5) * 0.08;
    const jL2 = (hash2(s, 17) - 0.5) * 0.09;
    const jTop = (hash2(s, 23) - 0.5) * 0.08;
    const jR2 = (hash2(s, 29) - 0.5) * 0.09;
    const jR1 = (hash2(s, 31) - 0.5) * 0.08;
    const inCore = Math.abs(s) < 7.25;
    // 在 cliff gate-liner 核心段把洞壳放在内侧连续包覆，外肩收低避免穿出 cliff 山体
    const shellScale = inCore ? 0.62 : 1.0;
    const effShoulderH = inCore ? vh + 0.65 : outerShoulderH;
    const effShoulderW = inCore ? hw + 0.90 : shoulderSpan;

    const pts = [
      { lat: cl - (hw + 0.16), y: -0.32, fracH: 0.04, n: hash2(s, 1) },
      { lat: cl - hw + jL1 * 0.45, y: vh * 0.38, fracH: 0.38, n: hash2(s, 2) },
      { lat: cl - hw * 0.88 + jL2 * 0.4, y: vh * 0.78, fracH: 0.78, n: hash2(s, 4) },
      { lat: cl + jTop * 0.4, y: vh, fracH: 0.98, n: hash2(s, 5) },
      { lat: cl + hw * 0.88 + jR2 * 0.4, y: vh * 0.78, fracH: 0.78, n: hash2(s, 6) },
      { lat: cl + hw + jR1 * 0.45, y: vh * 0.38, fracH: 0.38, n: hash2(s, 7) },
      { lat: cl + (hw + 0.16), y: -0.32, fracH: 0.04, n: hash2(s, 8) },
      { lat: cl + hw + 1.35 * shellScale, y: effShoulderH * (0.72 + 0.16 * hash2(s, 41)), fracH: 0.75, n: hash2(s, 9) },
      { lat: cl + effShoulderW + hash2(s, 43) * 0.8, y: -0.35, fracH: 0.12, n: hash2(s, 10) },
      { lat: cl - effShoulderW - hash2(s, 47) * 0.8, y: -0.35, fracH: 0.12, n: hash2(s, 12) },
      { lat: cl - hw - 1.35 * shellScale, y: effShoulderH * (0.72 + 0.16 * hash2(s, 53)), fracH: 0.75, n: hash2(s, 13) },
      { lat: cl + jTop * 0.9, y: effShoulderH * (0.94 + 0.12 * hash2(s, 59)), fracH: 0.95, n: hash2(s, 14) }
    ];

    const floorY = sampleFloorBaseY(s, cl, hw);
    for (const pt of pts) {
      const c = new THREE.Color();
      rockTint(s, pt.fracH, pt.n, c);
      ring.push({ p: toWorld(s, pt.lat, pt.y), c, m: [pt.fracH, 0.0] });
    }
    profilePoints.push({ s, cl, hw, floorY, inCore, ring });
  }

  for (let i = 0; i < profilePoints.length - 1; i++) {
    const a = profilePoints[i];
    const b = profilePoints[i + 1];
    // 跳过两侧完全落在 gate-liner 深处的外山脊面，内壁拱廊全长严丝合缝连续闭合（绝不隔环跳空）
    const bothInCore = a.inCore && b.inCore;
    // 内壁拱廊：0->1->2->3->4->5->6
    for (let j = 0; j < 6; j++) {
      pushQuad(
        a.ring[j].p, a.ring[j].c, b.ring[j].p, b.ring[j].c,
        b.ring[j + 1].p, b.ring[j + 1].c, a.ring[j + 1].p, a.ring[j + 1].c,
        a.ring[j].m, b.ring[j].m, b.ring[j + 1].m, a.ring[j + 1].m
      );
    }
    // 外部山脊护壳：右坡 8->7 -> 顶脊 11 -> 10 -> 左坡 9
    if (!bothInCore) {
      const outerEdges = [[8, 7], [7, 11], [11, 10], [10, 9]];
      for (const [u, v] of outerEdges) {
        pushQuad(
          a.ring[u].p, a.ring[u].c, b.ring[u].p, b.ring[u].c,
          b.ring[v].p, b.ring[v].c, a.ring[v].p, a.ring[v].c,
          a.ring[u].m, b.ring[u].m, b.ring[v].m, a.ring[v].m
        );
      }
    }

    // 2. 洞内石板路：沿全长铺设高于地形弦高的微拱潮湿青石踏面，彻底杜绝绿草地形三角面穿模
    const spanA = a.hw + 0.24;
    const spanB = b.hw + 0.24;
    const endA = Math.max(smooth01((a.s - 9) / 6.5), smooth01((-17 - a.s) / 8));
    const endB = Math.max(smooth01((b.s - 9) / 6.5), smooth01((-17 - b.s) / 8));
    const cFA = cFloorWet.clone().lerp(cFloorStone, 0.28 + 0.62 * endA);
    const cFB = cFloorWet.clone().lerp(cFloorStone, 0.28 + 0.62 * endB);
    const cFCtrA = cFA.clone().offsetHSL(0, -0.02, 0.035);
    const cFCtrB = cFB.clone().offsetHSL(0, -0.02, 0.035);
    pushQuad(
      floorWorldPt(a.s, a.cl - spanA, a.floorY, 0.0), cFA,
      floorWorldPt(a.s, a.cl, a.floorY, 0.022), cFCtrA,
      floorWorldPt(b.s, b.cl, b.floorY, 0.022), cFCtrB,
      floorWorldPt(b.s, b.cl - spanB, b.floorY, 0.0), cFB,
      floorMeta, floorMeta, floorMeta, floorMeta
    );
    pushQuad(
      floorWorldPt(a.s, a.cl, a.floorY, 0.022), cFCtrA,
      floorWorldPt(a.s, a.cl + spanA, a.floorY, 0.0), cFA,
      floorWorldPt(b.s, b.cl + spanB, b.floorY, 0.0), cFB,
      floorWorldPt(b.s, b.cl, b.floorY, 0.022), cFCtrB,
      floorMeta, floorMeta, floorMeta, floorMeta
    );
  }

  // 两端洞口厚石拱端面封口：消除壳层薄边
  for (const endIdx of [0, profilePoints.length - 1]) {
    const r = profilePoints[endIdx].ring;
    const faces = [
      [0, 9, 10], [0, 10, 1], [1, 10, 2], [2, 10, 11],
      [2, 11, 3], [3, 11, 4], [4, 11, 7], [4, 7, 5], [5, 7, 6], [6, 7, 8]
    ];
    for (const [a, b, c] of faces) {
      pushTri(r[a].p, r[a].c, r[b].p, r[b].c, r[c].p, r[c].c, r[a].m, r[b].m, r[c].m);
    }
  }

  // 3. 贴壁层理石肋：严格收于碰撞壁外侧与高处拱肩，绝不刺入通行走廊
  const ribLowMeta = [0.14, 0.0];
  const ribMidMeta = [0.52, 0.0];
  const ribTopMeta = [0.80, 0.0];
  const ribCoords = [13.8, 11.4, 9.1, -9.2, -12.0, -14.8, -17.6, -20.8, -23.6];
  for (let idx = 0; idx < ribCoords.length; idx++) {
    const s = ribCoords[idx];
    const cl = centerLat(s);
    const hw = halfWidth(s);
    const vh = vaultHeight(s);
    for (const side of [-1, 1]) {
      const hBlock = 1.85 + hash2(idx, side + 9) * 0.75;
      const xWall = cl + side * (hw + 0.02);
      const xUpper = cl + side * (hw * 0.84);
      const cA = rockTint(s, 0.45, hash2(idx, side), tmpC.clone());
      const cB = cA.clone().multiplyScalar(0.86);
      const p0 = toWorld(s - 0.36, xWall + side * 0.04, -0.10);
      const p1 = toWorld(s + 0.36, xWall + side * 0.04, -0.10);
      const p2 = toWorld(s + 0.24, xWall, Math.min(vh * 0.62, hBlock * 0.68));
      const p3 = toWorld(s - 0.24, xWall, Math.min(vh * 0.62, hBlock * 0.68));
      const p4 = toWorld(s, xUpper, Math.min(vh - 0.06, hBlock + 0.75));
      pushQuad(p0, cA, p1, cA, p2, cB, p3, cB, ribLowMeta, ribLowMeta, ribMidMeta, ribMidMeta);
      pushTri(p3, cB, p2, cB, p4, cA, ribMidMeta, ribMidMeta, ribTopMeta);
    }
  }

  // 两端崖壁外包巨石：让洞口与悬崖/谷地自然咬合，上帝视角看是一整条青苔石罅山脉延伸
  const capDefs = [
    { s: 14.6, lat: -2.4, rx: 1.6, ry: 2.3, rz: 1.8 },
    { s: 14.4, lat: 2.3, rx: 1.5, ry: 2.1, rz: 1.7 },
    { s: 11.2, lat: -2.9, rx: 2.0, ry: 3.4, rz: 2.2 },
    { s: 11.0, lat: 2.8, rx: 2.1, ry: 3.6, rz: 2.3 },
    { s: -10.0, lat: -3.1, rx: 2.4, ry: 4.5, rz: 2.5 },
    { s: -10.5, lat: 3.2, rx: 2.5, ry: 4.3, rz: 2.4 },
    { s: -15.5, lat: -3.2, rx: 2.2, ry: 3.8, rz: 2.4 },
    { s: -16.0, lat: 3.3, rx: 2.3, ry: 3.5, rz: 2.4 },
    { s: -21.5, lat: -3.8, rx: 2.1, ry: 2.6, rz: 2.2 },
    { s: -22.0, lat: 4.0, rx: 2.0, ry: 2.5, rz: 2.2 }
  ];
  const capBaseMeta = [0.16, 0.0];
  const capMidMeta = [0.58, 0.0];
  const capTopMeta = [0.88, 0.0];
  for (let i = 0; i < capDefs.length; i++) {
    const cap = capDefs[i];
    const cl = centerLat(cap.s);
    const lat = cl + cap.lat;
    const base = toWorld(cap.s, lat, -0.25);
    const driftS = (hash2(i, 71) - 0.5) * 0.38;
    const driftL = -Math.sign(cap.lat) * 0.28;
    const top = toWorld(cap.s + driftS, lat + driftL, cap.ry * 0.92);
    const cLow = rockTint(cap.s, 0.28, hash2(i, 73), tmpC.clone());
    const cMid = rockTint(cap.s, 0.58, hash2(i, 79), tmpC.clone());
    const cTip = cMid.clone().lerp(cMoss, 0.34);
    const sides = 6;
    const lowRing = [];
    const shoulderRing = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + i * 0.42;
      const rad = 0.74 + hash2(i, k * 3) * 0.34;
      const sRad = rad * (0.64 + hash2(i, k * 5 + 1) * 0.18);
      const sH = cap.ry * (0.56 + hash2(i, k * 7 + 2) * 0.18);
      lowRing.push([
        base[0] + Math.cos(a) * cap.rx * rad,
        base[1] + 0.08,
        base[2] + Math.sin(a) * cap.rz * rad
      ]);
      shoulderRing.push([
        base[0] + (top[0] - base[0]) * 0.55 + Math.cos(a + 0.12) * cap.rx * sRad,
        base[1] + sH,
        base[2] + (top[2] - base[2]) * 0.55 + Math.sin(a + 0.12) * cap.rz * sRad
      ]);
    }
    // 2-tier chamfered stratified cliff boulder (eliminates pointed cartoon cones at cave mouths)
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      pushQuad(lowRing[k], cLow, lowRing[k1], cLow, shoulderRing[k1], cMid, shoulderRing[k], cMid, capBaseMeta, capBaseMeta, capMidMeta, capMidMeta);
      pushTri(shoulderRing[k], cMid, shoulderRing[k1], cMid, top, cTip, capMidMeta, capMidMeta, capTopMeta);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aCaveMeta', new THREE.Float32BufferAttribute(meta, 2));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  });

  // 1b. 宋元「斧劈皴」斜向劈理石纹 + 下壁与石板踏面潮湿水膜微光（零新增 Draw Call，可与 sky 钩子无损串联）
  const uCaveSlitXZ = { value: new THREE.Vector2(slit.x, slit.z) };
  const uCaveAxisXZ = { value: new THREE.Vector2(ux, uz) };
  const uCaveSheenGain = { value: 1.0 };
  let fupicunHooked = false;

  {
    const prevHook = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    const baseKey = typeof prevKey === 'function' ? prevKey.call(mat) : '';
    const fupiHook = function onBeforeCompileCaveFupicun(shader, renderer) {
      if (typeof prevHook === 'function') prevHook.call(this, shader, renderer);
      if (!shader.vertexShader.includes('#include <begin_vertex>')) return;
      if (!shader.fragmentShader.includes('#include <color_fragment>')) return;

      shader.uniforms.uCaveSlitXZ = uCaveSlitXZ;
      shader.uniforms.uCaveAxisXZ = uCaveAxisXZ;
      shader.uniforms.uCaveSheenGain = uCaveSheenGain;

      if (!shader.vertexShader.includes('varying vec3 vCaveWorldPos;')) {
        shader.vertexShader =
          'attribute vec2 aCaveMeta;\n' +
          'varying vec3 vCaveWorldPos;\n' +
          'varying vec2 vCaveMeta;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            /* glsl */`
#include <begin_vertex>
vCaveMeta = aCaveMeta;
vCaveWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`
          );
      }

      if (!shader.fragmentShader.includes('varying vec3 vCaveWorldPos;')) {
        shader.fragmentShader =
          'uniform vec2 uCaveSlitXZ;\n' +
          'uniform vec2 uCaveAxisXZ;\n' +
          'uniform float uCaveSheenGain;\n' +
          'varying vec3 vCaveWorldPos;\n' +
          'varying vec2 vCaveMeta;\n' +
          shader.fragmentShader;
      }

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */`
#include <color_fragment>
float caveDampMask = 0.0;
float caveMouthSky = 0.32;
{
  float fracH = vCaveMeta.x;
  float isFloor = vCaveMeta.y;
  float sAlong = dot(vCaveWorldPos.xz - uCaveSlitXZ, uCaveAxisXZ);
  float outerMouth = smoothstep(5.5, 15.2, sAlong);
  float innerMouth = smoothstep(-13.0, -24.6, sAlong);
  caveMouthSky = max(0.28, max(outerMouth, innerMouth));

  // 宋元「大斧劈皴」：倾斜层理劈面 + 折带暗罅，石板路略收敛笔触保留凿石纹
  float strikeA = vCaveWorldPos.y * 2.38 + (vCaveWorldPos.x * 0.79 - vCaveWorldPos.z * 0.61) * 0.94;
  float strikeB = vCaveWorldPos.y * 1.18 - (vCaveWorldPos.x * 0.54 + vCaveWorldPos.z * 0.84) * 1.46;
  float warp = sin(strikeB * 2.25 + sin(strikeA * 1.65) * 1.35) * 0.30;
  float axeSaw = fract(strikeA + warp);
  float axePlane = smoothstep(0.05, 0.24, axeSaw) * (1.0 - 0.42 * smoothstep(0.24, 0.96, axeSaw));
  float axeCrevice = 1.0 - smoothstep(0.0, 0.115, axeSaw);
  float crossFissure = 1.0 - smoothstep(0.0, 0.075, abs(fract(strikeB * 0.88 + axeSaw * 0.16) - 0.5));

  float rockWeight = mix(1.0, 0.42, isFloor);
  float fupiShade = 1.0 + (axePlane * 0.10 - axeCrevice * 0.22 - crossFissure * 0.10) * rockWeight;
  if (isFloor > 0.5) {
    float slabSeam = 1.0 - smoothstep(0.0, 0.06, abs(fract(sAlong * 0.68 + sin(vCaveWorldPos.x * 1.9) * 0.08) - 0.5));
    fupiShade -= slabSeam * 0.09;
  }
  diffuseColor.rgb *= clamp(fupiShade, 0.64, 1.14);

  // 下壁 (fracH < 0.45) 与洞底青石踏面渗水深润压暗
  float seepWave = 0.5 + 0.5 * sin(vCaveWorldPos.x * 2.7 + vCaveWorldPos.z * 2.3 + strikeB * 0.7);
  float wallDamp = smoothstep(0.45, 0.03, fracH) * (0.58 + 0.42 * seepWave);
  caveDampMask = max(isFloor * (0.55 + 0.45 * caveMouthSky), wallDamp);
  diffuseColor.rgb *= (1.0 - caveDampMask * 0.14);
}
`
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */`
if (caveDampMask > 0.01) {
  vec3 caveViewDir = normalize(vViewPosition);
  float graze = pow(clamp(1.0 - abs(dot(normal, caveViewDir)), 0.0, 1.0), 2.35);
  float wetFloorGlint = vCaveMeta.y * pow(clamp(normal.y * 0.5 + 0.5, 0.0, 1.0), 2.0) * 0.35;
  vec3 seepColor = vec3(0.60, 0.71, 0.68) * (0.32 + 0.68 * caveMouthSky) * uCaveSheenGain;
  outgoingLight += clamp(seepColor * caveDampMask * (graze * 0.26 + wetFloorGlint * 0.14), vec3(0.0), vec3(0.22));
}
#include <opaque_fragment>
`
        );
    };
    mat.onBeforeCompile = fupiHook;
    mat.customProgramCacheKey = function customCaveFupicunKey() {
      const pk = (typeof prevKey === 'function' && prevKey !== THREE.Material.prototype.customProgramCacheKey)
        ? prevKey.call(this)
        : baseKey;
      return pk ? `${pk}|cave-fupicun-v1` : 'cave-fupicun-v1';
    };
    mat.needsUpdate = true;
    fupicunHooked = true;
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cave-passage-shell';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  group.add(mesh);

  // 3b. 两端洞口垂挂青藤与石罅石韦蕨丛（cave-mouth-vines，单次烘焙 Mesh，绝不遮挡 2.22m 以下视线/头顶）
  const vPos = [];
  const vCol = [];
  const cStemDark = new THREE.Color('#3D4D2E');
  const cLeafDeep = new THREE.Color('#3B5B30');
  const cLeafMid = new THREE.Color('#53773D');
  const cLeafTip = new THREE.Color('#749852');
  const cFernRoot = new THREE.Color('#36502C');
  const cFernTip = new THREE.Color('#668847');

  function pushVineTri(a, ca, b, cb, c, cc) {
    vPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    vCol.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }

  function addHangingVineStrand(s, latFrac, seedIdx) {
    const cl = centerLat(s);
    const hw = halfWidth(s);
    const vh = vaultHeight(s);
    const lat = cl + latFrac * hw * 0.78;
    const gx = slit.x + ux * s + tx * lat;
    const gz = slit.z + uz * s + tz * lat;
    const gY = field?.sample ? field.sample(gx, gz) : (slit.ground ?? 2.0);
    const floorY = sampleFloorBaseY(s, cl, hw);
    const minSafeY = Math.max(floorY, gY) + 2.26; // 严格 >= 2.22m 净空
    const archY = gY + vh * (1.0 - 0.20 * latFrac * latFrac) - 0.04;
    const topY = Math.max(minSafeY + 0.36, archY);
    const rawDrop = 0.42 + hash2(seedIdx, 19) * 0.46 * (1.0 - 0.35 * Math.abs(latFrac));
    const botY = Math.max(minSafeY + 0.06, topY - rawDrop);
    const segs = 5;

    for (let k = 0; k < segs; k++) {
      const t0 = k / segs;
      const t1 = (k + 1) / segs;
      const y0 = topY + (botY - topY) * t0;
      const y1 = topY + (botY - topY) * t1;
      const sway0 = Math.sin(t0 * 4.2 + seedIdx) * 0.035;
      const sway1 = Math.sin(t1 * 4.2 + seedIdx) * 0.035;
      const x0 = gx + tx * sway0;
      const z0 = gz + tz * sway0;
      const x1 = gx + tx * sway1;
      const z1 = gz + tz * sway1;
      const w = 0.011 * (1 - t0 * 0.35);

      pushVineTri(
        [x0 - tx * w, y0, z0 - tz * w], cStemDark,
        [x0 + tx * w, y0, z0 + tz * w], cStemDark,
        [x1, y1, z1], cLeafDeep
      );

      // 交替对生尖叶（叶尖同样严格守住 >= 2.22m 净空）
      const side = (k + seedIdx) % 2 === 0 ? 1 : -1;
      for (const pair of [side, -side * 0.65]) {
        const leafAng = Math.atan2(tz, tx) + pair * (0.85 + hash2(seedIdx, k * 7) * 0.35);
        const leafLen = 0.11 + (1 - t0 * 0.3) * 0.05;
        const leafW = leafLen * 0.42;
        const lyBase = Math.max(minSafeY + 0.04, (y0 + y1) * 0.5);
        const lyTip = Math.max(minSafeY + 0.01, lyBase - 0.035);
        const dirX = Math.cos(leafAng);
        const dirZ = Math.sin(leafAng);
        const px = -dirZ;
        const pz = dirX;
        const rootPt = [x0, lyBase, z0];
        const midL = [x0 + dirX * leafLen * 0.45 + px * leafW, lyBase - 0.01, z0 + dirZ * leafLen * 0.45 + pz * leafW];
        const midR = [x0 + dirX * leafLen * 0.45 - px * leafW, lyBase - 0.01, z0 + dirZ * leafLen * 0.45 - pz * leafW];
        const tipPt = [x0 + dirX * leafLen, lyTip, z0 + dirZ * leafLen];
        pushVineTri(rootPt, cLeafDeep, midL, cLeafMid, tipPt, cLeafTip);
        pushVineTri(rootPt, cLeafDeep, tipPt, cLeafTip, midR, cLeafMid);
      }
    }
  }

  // 外口「山有小口」(s ~ +14.0..+15.4) 与内口「豁然开朗」(s ~ -22.8..-24.9) 拱眉垂藤
  const outerVineSlots = [-0.74, -0.55, -0.36, -0.18, 0.02, 0.21, 0.40, 0.58, 0.75];
  for (let i = 0; i < outerVineSlots.length; i++) {
    const s = 14.05 + hash2(i, 101) * 1.32;
    addHangingVineStrand(s, outerVineSlots[i], i + 10);
  }
  const innerVineSlots = [-0.80, -0.66, -0.52, -0.38, -0.24, -0.10, 0.04, 0.18, 0.32, 0.46, 0.60, 0.72, 0.82];
  for (let i = 0; i < innerVineSlots.length; i++) {
    const s = -22.85 - hash2(i, 211) * 2.02;
    addHangingVineStrand(s, innerVineSlots[i], i + 40);
  }

  // 两端外侧岩肩石罅「石韦」蕨丛（严格植于 |lat - cl| >= hw + 0.38，绝不侵入走廊）
  const fernAnchorDefs = [
    { s: 15.2, side: -1, extra: 0.42, lift: 0.18 },
    { s: 15.0, side: 1, extra: 0.45, lift: 0.22 },
    { s: 14.3, side: -1, extra: 0.62, lift: 0.55 },
    { s: 14.1, side: 1, extra: 0.58, lift: 0.48 },
    { s: 13.5, side: -1, extra: 0.85, lift: 0.82 },
    { s: -22.6, side: -1, extra: 0.52, lift: 0.45 },
    { s: -22.9, side: 1, extra: 0.56, lift: 0.52 },
    { s: -23.7, side: -1, extra: 0.44, lift: 0.24 },
    { s: -24.0, side: 1, extra: 0.48, lift: 0.28 },
    { s: -24.7, side: -1, extra: 0.40, lift: 0.12 },
    { s: -24.8, side: 1, extra: 0.42, lift: 0.14 }
  ];

  for (let cIdx = 0; cIdx < fernAnchorDefs.length; cIdx++) {
    const fd = fernAnchorDefs[cIdx];
    const cl = centerLat(fd.s);
    const hw = halfWidth(fd.s);
    const lat = cl + fd.side * (hw + Math.max(0.36, fd.extra));
    const root = toWorld(fd.s, lat, fd.lift);
    const frondCount = 7;
    const baseOutAng = Math.atan2(tz * fd.side, tx * fd.side);

    for (let f = 0; f < frondCount; f++) {
      const fan = ((f / (frondCount - 1)) - 0.5) * 1.95 + (hash2(cIdx, f * 5) - 0.5) * 0.22;
      const ang = baseOutAng + fan;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const px = -dz;
      const pz = dx;
      const fLen = 0.34 + hash2(cIdx + 3, f * 11) * 0.22;
      const fRise = 0.24 + hash2(cIdx + 7, f * 13) * 0.16;
      const halfBlade = 0.036;

      const p0 = root;
      const p1 = [root[0] + dx * fLen * 0.48, root[1] + fRise * 0.88, root[2] + dz * fLen * 0.48];
      const p2 = [root[0] + dx * fLen, root[1] + fRise * 0.42, root[2] + dz * fLen];

      const m1L = [p1[0] + px * halfBlade, p1[1], p1[2] + pz * halfBlade];
      const m1R = [p1[0] - px * halfBlade, p1[1], p1[2] - pz * halfBlade];

      pushVineTri(p0, cFernRoot, m1L, cLeafMid, m1R, cLeafMid);
      pushVineTri(m1L, cLeafMid, p2, cFernTip, m1R, cLeafMid);
    }
  }

  const vinesGeo = new THREE.BufferGeometry();
  vinesGeo.setAttribute('position', new THREE.Float32BufferAttribute(vPos, 3));
  vinesGeo.setAttribute('color', new THREE.Float32BufferAttribute(vCol, 3));
  vinesGeo.computeVertexNormals();
  vinesGeo.computeBoundingSphere();

  const vinesMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const vinesMesh = new THREE.Mesh(vinesGeo, vinesMat);
  vinesMesh.name = 'cave-mouth-vines';
  vinesMesh.matrixAutoUpdate = false;
  vinesMesh.updateMatrix();
  group.add(vinesMesh);

  // 3c. 钟乳岩隙滴水与石板积水同心微澜（cave-ceiling-drips：8 实例 = 4 水珠 + 4 石面涟漪环）
  const dripStationDefs = [
    { s: -16.5, side: -1, period: 2.75, phase: 0.14 },
    { s: -9.8, side: 1, period: 3.15, phase: 0.41 },
    { s: 2.4, side: -1, period: 2.55, phase: 0.67 },
    { s: 9.6, side: 1, period: 2.95, phase: 0.89 }
  ];
  const dripStations = dripStationDefs.map(st => {
    const cl = centerLat(st.s);
    const hw = halfWidth(st.s);
    const vh = vaultHeight(st.s);
    const lat = cl + st.side * hw * 0.68;
    const gx = slit.x + ux * st.s + tx * lat;
    const gz = slit.z + uz * st.s + tz * lat;
    const gY = field?.sample ? field.sample(gx, gz) : (slit.ground ?? 2.0);
    const floorY = sampleFloorBaseY(st.s, cl, hw);
    const ceilY = Math.max(floorY + 1.85, gY + vh * 0.84 - 0.06);
    return {
      x: gx,
      z: gz,
      floorY,
      puddleY: floorY + 0.028,
      ceilY,
      period: st.period,
      phase: st.phase
    };
  });

  const dripGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 12, 1, false);
  const dripStateArray = new Float32Array(8 * 2); // [isRing, alpha]
  const dripStateAttr = new THREE.InstancedBufferAttribute(dripStateArray, 2);
  dripGeo.setAttribute('aDripState', dripStateAttr);

  const dripMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec2 aDripState;
      varying vec3 vLocalPos;
      varying vec2 vDripState;
      void main() {
        vLocalPos = position;
        vDripState = aDripState;
        #ifdef USE_INSTANCING
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vLocalPos;
      varying vec2 vDripState;
      void main() {
        float isRing = vDripState.x;
        float alpha = vDripState.y;
        if (alpha <= 0.005) discard;
        vec3 col;
        float outA;
        if (isRing < 0.5) {
          float radial = clamp(1.0 - length(vLocalPos.xz) * 1.8, 0.0, 1.0);
          float spec = smoothstep(0.05, 0.48, vLocalPos.y);
          col = mix(vec3(0.68, 0.83, 0.82), vec3(0.93, 0.98, 0.98), spec * 0.75 + radial * 0.25);
          outA = alpha * (0.55 + 0.45 * radial);
        } else {
          float r = length(vLocalPos.xz) * 2.0;
          if (r > 1.0) discard;
          float outerRing = exp(-pow((r - 0.88) * 13.5, 2.0));
          float innerRing = 0.58 * exp(-pow((r - 0.48) * 11.5, 2.0));
          float ringMask = outerRing + innerRing;
          if (ringMask < 0.04) discard;
          col = vec3(0.76, 0.88, 0.87);
          outA = clamp(ringMask * alpha, 0.0, 0.85);
        }
        gl_FragColor = vec4(col, outA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  dripMat.userData = { skyIgnore: true };

  const dripsMesh = new THREE.InstancedMesh(dripGeo, dripMat, 8);
  dripsMesh.name = 'cave-ceiling-drips';
  dripsMesh.frustumCulled = false;
  group.add(dripsMesh);

  let simTime = 0;
  const _dripPos = new THREE.Vector3();
  const _dripQuat = new THREE.Quaternion();
  const _dripScale = new THREE.Vector3();
  const _dripMat4 = new THREE.Matrix4();

  function syncDripInstances(clockSec) {
    for (let i = 0; i < 4; i++) {
      const st = dripStations[i];
      const cyc = ((clockSec / st.period) + st.phase) % 1.0;

      // 实例 0..3：岩顶凝聚与重力坠落水珠
      if (cyc < 0.18) {
        const gather = cyc / 0.18;
        _dripPos.set(st.x, st.ceilY - 0.015 * gather, st.z);
        _dripScale.set(0.018 + 0.010 * gather, 0.026 + 0.024 * gather, 0.018 + 0.010 * gather);
        dripStateArray[i * 2] = 0.0;
        dripStateArray[i * 2 + 1] = 0.82 * smooth01(gather);
      } else if (cyc < 0.52) {
        const fallU = (cyc - 0.18) / 0.34;
        const dropY = st.ceilY - 0.015 - (st.ceilY - 0.015 - st.puddleY) * (fallU * fallU);
        _dripPos.set(st.x, dropY, st.z);
        _dripScale.set(0.022, 0.052 + fallU * 0.055, 0.022);
        dripStateArray[i * 2] = 0.0;
        dripStateArray[i * 2 + 1] = 0.88;
      } else {
        _dripPos.set(st.x, st.puddleY - 0.25, st.z);
        _dripScale.set(0.001, 0.001, 0.001);
        dripStateArray[i * 2] = 0.0;
        dripStateArray[i * 2 + 1] = 0.0;
      }
      _dripMat4.compose(_dripPos, _dripQuat, _dripScale);
      dripsMesh.setMatrixAt(i, _dripMat4);

      // 实例 4..7：落水瞬间在 floorY + 0.028 处舒展的同心涟漪双环
      const ringIdx = i + 4;
      const ringAge = cyc >= 0.52 ? (cyc - 0.52) / 0.48 : -1.0;
      if (ringAge >= 0.0) {
        const radius = 0.055 + 0.32 * Math.sqrt(ringAge);
        const fade = (1.0 - ringAge) * (1.0 - ringAge) * 0.78;
        _dripPos.set(st.x, st.puddleY, st.z);
        _dripScale.set(radius * 2.0, 0.005, radius * 2.0);
        dripStateArray[ringIdx * 2] = 1.0;
        dripStateArray[ringIdx * 2 + 1] = fade;
      } else {
        _dripPos.set(st.x, st.puddleY - 0.25, st.z);
        _dripScale.set(0.001, 0.001, 0.001);
        dripStateArray[ringIdx * 2] = 1.0;
        dripStateArray[ringIdx * 2 + 1] = 0.0;
      }
      _dripMat4.compose(_dripPos, _dripQuat, _dripScale);
      dripsMesh.setMatrixAt(ringIdx, _dripMat4);
    }
    dripsMesh.instanceMatrix.needsUpdate = true;
    dripStateAttr.needsUpdate = true;
  }
  syncDripInstances(0);

  // 4. 清除隧道内穿插的野生草叶/野花实例（仅平移至地面以下并保持矩阵可逆）
  if (scatter?.group) {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    scatter.group.traverse(obj => {
      if (!obj.isInstancedMesh || !obj.instanceMatrix) return;
      let dirty = false;
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const dx = p.x - slit.x;
        const dz = p.z - slit.z;
        const sAlong = dx * ux + dz * uz;
        if (sAlong < INNER_S - 0.5 || sAlong > OUTER_S + 0.5) continue;
        const lat = dx * tx + dz * tz;
        if (Math.abs(lat - centerLat(sAlong)) < halfWidth(sAlong) + 1.8) {
          m.elements[13] -= 5.0;
          obj.setMatrixAt(i, m);
          dirty = true;
        }
      }
      if (dirty) obj.instanceMatrix.needsUpdate = true;
    });
  }

  // 4b. 收纳原 cliff-dress 散落在新延展洞口踏面中央的无碰撞碎石，避免穿脚挡道
  const cliffDress = cliff?.group?.getObjectByName?.('cliff-dress');
  if (cliffDress?.isInstancedMesh && cliffDress.instanceMatrix) {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const q = new THREE.Quaternion();
    let dirty = false;
    for (let i = 0; i < cliffDress.count; i++) {
      cliffDress.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      const dx = p.x - slit.x;
      const dz = p.z - slit.z;
      const sAlong = dx * ux + dz * uz;
      if (sAlong < INNER_S - 1.2 || sAlong > OUTER_S + 1.2) continue;
      const gY = field?.sample ? field.sample(p.x, p.z) : (slit.ground ?? 2.0);
      if (p.y - gY > 2.1) continue;
      const lat = dx * tx + dz * tz;
      const rockReach = Math.max(sc.x, sc.z) * 0.85;
      if (Math.abs(lat - centerLat(sAlong)) < halfWidth(sAlong) + rockReach * 0.75) {
        m.elements[13] -= 6.0;
        cliffDress.setMatrixAt(i, m);
        dirty = true;
      }
    }
    if (dirty) cliffDress.instanceMatrix.needsUpdate = true;
  }

  // 5. 沿 S 型曲线布置高密度正切对齐的碰撞体（修正 -edgeAng 法向符号，全长滑行不卡模、不嵌壁）
  const blockers = [];
  const segLen = 1.15;
  const wallThickHalf = 0.65;
  const segCount = Math.ceil((OUTER_S - INNER_S - 1.0) / segLen);
  for (let i = 0; i < segCount; i++) {
    const s0 = INNER_S + 0.6 + i * segLen;
    const s1 = Math.min(OUTER_S - 0.3, s0 + segLen + 0.24);
    const sm = (s0 + s1) * 0.5;
    const cl0 = centerLat(s0);
    const cl1 = centerLat(s1);
    const clm = (cl0 + cl1) * 0.5;
    const hwm = (halfWidth(s0) + halfWidth(s1)) * 0.5;
    const ds = s1 - s0;
    const dl = cl1 - cl0;
    const edgeAng = Math.atan2(dl, ds);
    const hd = Math.hypot(ds, dl) * 0.5 + 0.24;
    const rot = Math.PI * 0.5 - slit.angle - edgeAng;

    for (const side of [-1, 1]) {
      // 严丝合缝贴合内壁网格，0.42m 玩家半径在最窄处（1.94m）仍有 > 1.08m 顺滑通道且绝不嵌入岩壁
      const wallCenterLat = clm + side * (hwm + 0.01 + wallThickHalf);
      const bx = slit.x + ux * sm + tx * wallCenterLat;
      const bz = slit.z + uz * sm + tz * wallCenterLat;
      const baseMaxY = vaultHeight(sm) + 4;
      blockers.push({
        x: bx,
        z: bz,
        hw: wallThickHalf,
        hd,
        rot,
        minY: 0,
        maxY: baseMaxY,
        _baseX: bx,
        _baseZ: bz,
        _baseHw: wallThickHalf,
        _baseHd: hd,
        _baseMinY: 0,
        _baseMaxY: baseMaxY,
        source: 'cave-passage-wall'
      });
    }
  }

  // 6. 全长隧道昏暗遮罩（补足 main.js 原有 13m 以外区间的暗影，洞外即散）
  const doc = typeof document !== 'undefined' ? document : null;
  let shadeEl = null;
  if (doc?.body?.appendChild && doc?.createElement) {
    shadeEl = doc.createElement('div');
    shadeEl.id = 'cave-passage-gloom';
    shadeEl.setAttribute('aria-hidden', 'true');
    shadeEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;transition:opacity 0.12s linear;background:radial-gradient(circle at 50% 48%, rgba(16,18,14,0.16) 0%, rgba(10,12,9,0.58) 70%, rgba(6,8,6,0.82) 100%);';
    doc.body.appendChild(shadeEl);
  }

  let lastShade = '0';
  const maxGloom = world?.gloom?.max ?? 0.58;

  function computeGloom(camPos) {
    if (!camPos) return 0;
    const dx = camPos.x - slit.x;
    const dz = camPos.z - slit.z;
    const sAlong = dx * ux + dz * uz;
    if (sAlong < INNER_S - 1.5 || sAlong > OUTER_S + 1.5) return 0;
    const groundY = field?.sample ? field.sample(camPos.x, camPos.z) : (slit.ground ?? 2.0);
    if (camPos.y > groundY + vaultHeight(clamp(sAlong, INNER_S, OUTER_S)) + 1.2) return 0;
    const lat = dx * tx + dz * tz;
    if (Math.abs(lat - centerLat(sAlong)) > halfWidth(sAlong) + 1.8) return 0;

    // 总体沿洞深平滑变暗曲线（在外口 +15.5 和内口 -25 处均渐亮散去）
    const fromOuter = clamp((OUTER_S + 0.6 - sAlong) / 7.5, 0, 1);
    const fromInner = clamp((sAlong - (INNER_S + 0.5)) / 7.5, 0, 1);
    const desired = smooth01(Math.min(fromOuter, fromInner)) * (maxGloom * 0.92);

    // 扣除 main.js 原生 gloomEl 在 slitDist < 13 内已经提供的不透明度，防止双重叠加过黑
    const slitDist = Math.hypot(dx, dz);
    const baseK = Math.max(0, 1 - slitDist / 13);
    const baseGloom = baseK * baseK * maxGloom;
    return clamp((desired - baseGloom) / Math.max(0.15, 1 - baseGloom), 0, 0.72);
  }

  let wasSealed = false;

  function update(camPos, isGodFlight = false, isSealed = false, dt = 0, sky = null) {
    const sealed = Boolean(isSealed);
    group.visible = !sealed;
    if (sealed !== wasSealed) {
      wasSealed = sealed;
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        if (sealed) {
          b.x = 99999;
          b.z = 99999;
          b.hw = 0;
          b.hd = 0;
          b.minY = -1000;
          b.maxY = -999;
        } else {
          b.x = b._baseX;
          b.z = b._baseZ;
          b.hw = b._baseHw;
          b.hd = b._baseHd;
          b.minY = b._baseMinY;
          b.maxY = b._baseMaxY;
        }
      }
    }

    if (sky && typeof sky === 'object') {
      const tId = sky.timeId || sky.getAppearance?.()?.timeId || 'day';
      const rainVal = Number.isFinite(sky.rainIntensity) ? sky.rainIntensity : 0;
      const timeScale = tId === 'night' ? 0.58 : (tId === 'dusk' || tId === 'dawn' ? 0.85 : 1.0);
      uCaveSheenGain.value = timeScale * (1.0 + clamp(rainVal, 0, 1) * 0.22);
    }

    // 严格暂停冻结：仅在 dt > 0 且有限、且洞道未封合时推进水滴重力坠落与涟漪扩散
    if (!sealed && Number.isFinite(dt) && dt > 0) {
      simTime += Math.min(dt, 0.1);
      syncDripInstances(simTime);
    }

    if (!shadeEl) return;
    const val = (sealed || isGodFlight) ? 0 : computeGloom(camPos);
    const next = val <= 0.005 ? '0' : val.toFixed(3);
    if (next !== lastShade) {
      lastShade = next;
      shadeEl.style.opacity = next;
    }
  }

  let minW = Infinity;
  let maxW = 0;
  for (let s = INNER_S; s <= OUTER_S; s += 0.5) {
    const w = halfWidth(s) * 2;
    if (w < minW) minW = w;
    if (w > maxW) maxW = w;
  }

  return {
    group,
    vinesMesh,
    dripsMesh,
    blockers,
    layout: {
      outerS: OUTER_S,
      innerS: INNER_S,
      lengthMeters: TOTAL_LEN,
      outerMouth: toWorld(OUTER_S, centerLat(OUTER_S), 0),
      innerMouth: toWorld(INNER_S, centerLat(INNER_S), 0),
      minWidthMeters: +minW.toFixed(2),
      maxWidthMeters: +maxW.toFixed(2)
    },
    centerLat,
    halfWidth,
    computeGloom,
    update,
    getStats: () => ({
      built: true,
      lengthMeters: TOTAL_LEN,
      minWidthMeters: +minW.toFixed(2),
      maxWidthMeters: +maxW.toFixed(2),
      blockerCount: blockers.length,
      fupicunHooked,
      vinesMesh,
      dripsMesh,
      dripInstances: dripsMesh.count,
      simTime: +simTime.toFixed(4)
    }),
    dispose() {
      geo.dispose();
      mat.dispose();
      vinesGeo.dispose();
      vinesMat.dispose();
      dripGeo.dispose();
      dripMat.dispose();
      shadeEl?.remove?.();
      group.removeFromParent();
    }
  };
}
