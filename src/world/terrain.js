import * as THREE from 'three';
import { Heightfield } from '../player/collision.js';
import inkLandscape from '../data/ink-landscape.json' with { type: 'json' };
import phenologySeasons from '../data/phenology-seasons.json' with { type: 'json' };
import { shadeInkGround, createMountainHaze } from './ink-landscape.js';
import { bankPatch, riverbankMask, riverbankRelief } from './riverbank.js';

function ihash(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = ihash(x0, y0);
  const b = ihash(x0 + 1, y0);
  const c = ihash(x0, y0 + 1);
  const d = ihash(x0 + 1, y0 + 1);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

// 宣纸颗粒：程序化噪声贴图，铺在地面上压住大片塑料感的渐变（无位图资源）
function paperTexture(repeat, seed) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  let s = seed || 7;
  function rnd() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }
  for (let i = 0; i < size * size; i++) {
    // 两层：细颗粒 + 一点低频斑
    const y = (i / size) | 0;
    const x = i % size;
    const fine = rnd() - 0.5;
    const blot = valueNoise(x * 0.05 + 3.3, y * 0.05 - 1.7) - 0.5;
    const v = 1 + fine * 0.09 + blot * 0.13;
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    d[i * 4] = c;
    d[i * 4 + 1] = c;
    d[i * 4 + 2] = c;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fbm(x, y, octaves) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 到折线（河道中轴）的最短距离
export function createRiverDistance(points) {
  const pts = points.map(function (p) { return [p[0], p[1]]; });
  return function distanceToRiver(x, z) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const dx = pts[i + 1][0] - ax;
      const dz = pts[i + 1][1] - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
}

// 山口收束系数：1 = 正常河宽，越小越窄。地形与水面必须共用这一条，否则岸会错位。
export function chokeFactor(cfg, x, z) {
  const ch = cfg.choke;
  if (!ch) return 1;
  const d = Math.sqrt((x - ch.x) * (x - ch.x) + (z - ch.z) * (z - ch.z));
  return 1 - (1 - ch.factor) * (1 - smoothstep(ch.r0, ch.r1, d));
}

// 高度函数：河谷低地 + 河槽下切 + 远处丘陵 + 桃源盆地压平 + 美池下凹
export function createHeightFunction(cfg, distanceToRiver) {
  const bed = -cfg.riverDepth;
  const basin = cfg.basin || null;
  const pond = cfg.pond || null;

  // 盆地系数：0 = 原始丘陵，1 = 完全压平成平旷土地
  function basinK(x, z) {
    if (!basin) return 0;
    const dx = x - basin.x;
    const dz = z - basin.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    return 1 - smoothstep(basin.inner, basin.outer, r);
  }

  return function heightAt(x, z) {
    const d = distanceToRiver(x, z);
    const bk = basinK(x, z);

    let hill = fbm(x * cfg.noiseScale, z * cfg.noiseScale, cfg.octaves) * cfg.heightScale;
    let top = cfg.plainHeight;
    if (bk > 0) {
      hill = hill * (1 - bk) + basin.height * bk;
      top = top * (1 - bk) + basin.height * bk;
    }

    const ch = chokeFactor(cfg, x, z);
    const bankW = cfg.bankWidth * ch;
    const bedY = bed * (1 - (cfg.choke ? cfg.choke.bedLift * (1 - ch) : 0));

    let h;
    if (d < bankW) {
      const k = d / bankW;
      const wobble = (fbm(x * 0.062 + 5.5, z * 0.062 - 2.7, 2) - 0.5) * (cfg.shoreWobble ?? 0) * smoothstep(0, 7, d);
      const swell = (fbm(x * 0.092 + 31.7, z * 0.092 - 8.3, 3) - 0.5) * (cfg.bankSwell ?? 0) * smoothstep(3, 14, d);
      h = bedY + Math.pow(k, cfg.bankPower ?? 1.7) * (top - bedY) + wobble + swell;
    } else {
      const t = 1 - smoothstep(cfg.bankWidth, cfg.plainRadius, d);
      h = hill + (top - hill) * t;
    }

    // 盆地极轻微的起伏：让 flatShading 的三角面有明暗，不然平得像一张渐变纸
    if (bk > 0.001) {
      const u = fbm(x * 0.075 + 41.2, z * 0.075 - 7.7, 2) - 0.5;
      h += u * 0.9 * bk * bk;
    }

    // Exterior shallow shoals / cut banks use this same collision grid; dry ground stays put.
    h += riverbankRelief(cfg, x, z, d, h);

    // 洞口平台：把窄口前后压平，给一条平整的石板路穿过山门
    const portal = cfg.portal;
    if (portal) {
      const pdx = x - portal.x;
      const pdz = z - portal.z;
      let along = pdx * portal.ux + pdz * portal.uz;
      along = along < -portal.halfLen ? -portal.halfLen : along > portal.halfLen ? portal.halfLen : along;
      const ex = pdx - portal.ux * along;
      const ez = pdz - portal.uz * along;
      const pd = Math.sqrt(ex * ex + ez * ez);
      const pk = 1 - smoothstep(portal.halfW, portal.halfW + 9, pd);
      if (pk > 0) h = h * (1 - pk) + portal.y * pk;
    }

    // 美池：在平原上压出一个碗，池面靠单独的水面片
    if (pond) {
      const pr = Math.sqrt((x - pond.x) * (x - pond.x) + (z - pond.z) * (z - pond.z));
      h -= pond.depth * (1 - smoothstep(pond.radius * 0.3, pond.radius, pr));
    }

    return h;
  };
}

export function createTerrain(cfg, distanceToRiver, look = {}) {
  const heightAt = createHeightFunction(cfg, distanceToRiver);
  const geo = new THREE.PlaneGeometry(cfg.size, cfg.size, cfg.segments, cfg.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const heights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    heights[i] = h;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const field = new Heightfield(cfg.size, cfg.segments, heights);

  const cSilt = new THREE.Color(cfg.palette.silt);
  const cBank = new THREE.Color(cfg.palette.bank);
  const cWetStone = new THREE.Color('#6D7764');
  const cPebble = new THREE.Color('#A7A086');
  const cPondBed = new THREE.Color('#5A7568');
  const cGrass = new THREE.Color(cfg.palette.grass);
  const cDeep = new THREE.Color(cfg.palette.deep);
  const cRidge = new THREE.Color(cfg.palette.ridge);
  const cPath = new THREE.Color(cfg.palette.path || '#C9BFA0');
  const col = new THREE.Color();
  const surface = cfg.surface;
  const ink = (look.inkLandscape || inkLandscape).terrain;
  const cPimaMalachite = new THREE.Color(ink.pimaMalachite || '#528870');
  const cPimaAzurite = new THREE.Color(ink.pimaAzurite || '#467378');
  const cPimaOchre = new THREE.Color(ink.pimaOchre || '#967B56');
  const cPimaInk = new THREE.Color(ink.pimaInk || '#395348');
  const cPimaStrata = new THREE.Color(ink.pimaStrata || '#7E7A66');
  const sunWarmLen = Math.hypot(ink.warmDirection?.[0] ?? 0.8, ink.warmDirection?.[1] ?? -0.6) || 1;
  const sunWarmX = (ink.warmDirection?.[0] ?? 0.8) / sunWarmLen;
  const sunWarmZ = (ink.warmDirection?.[1] ?? -0.6) / sunWarmLen;
  const moss = new THREE.Color(surface?.moss || cfg.palette.deep);
  const earth = new THREE.Color(surface?.earth || cfg.palette.path);
  const road = look.road;
  const roadDistance = (x, z) => {
    let nearest = Infinity;
    for (let i = 1; i < (road?.points.length || 0); i++) {
      const a = road.points[i - 1], b = road.points[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      nearest = Math.min(nearest, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    }
    return nearest;
  };


  // 任一点的地面色：与网格顶点用的是同一套公式，色斑/地贴靠它对齐边界
  const groundColor = function (x, z, h, slope, out) {
    const c = out || new THREE.Color();
    // Continuous submerged-to-bank wash, not a threshold at waterLevel - .35.
    const dryBank = smoothstep(cfg.waterLevel + ink.bankBlend[0], cfg.waterLevel + ink.bankBlend[1], h);
    {
      c.copy(cBank).lerp(cGrass, smoothstep(cfg.waterLevel + 0.08, cfg.waterLevel + 1.25, h));
      // 溪岸水际湿石与滩涂卵石斑驳带，消解水面与绿岸的生硬切线
      const shingleNoise = fbm(x * 0.24 + 11.3, z * 0.24 - 6.7, 2);
      const wetBand = (1 - smoothstep(cfg.waterLevel - 0.12, cfg.waterLevel + 0.42, h)) * smoothstep(cfg.waterLevel - 0.42, cfg.waterLevel - 0.06, h);
      const pebbleBand = (1 - smoothstep(cfg.waterLevel + 0.15, cfg.waterLevel + 1.05, h)) * smoothstep(cfg.waterLevel - 0.1, cfg.waterLevel + 0.22, h);
      c.lerp(cWetStone, wetBand * (0.42 + 0.36 * shingleNoise));
      c.lerp(cPebble, pebbleBand * smoothstep(0.38, 0.76, shingleNoise) * 0.48);
      c.lerp(cDeep, smoothstep(5, 14, h));
      c.lerp(cRidge, smoothstep(15, 22.5, h) * (0.55 + 0.45 * Math.min(1, slope * 1.6)));
    }
    c.lerp(cSilt, 1 - dryBank);
    if (cfg.shoreline) {
      const bank = riverbankMask(cfg, x, z, distanceToRiver(x, z), h);
      const shingle = smoothstep(0.42, 0.78, bankPatch(x, z));
      // Broken ochre shingle tongues, not a continuous painted shoreline stripe.
      c.lerp(cPebble, bank * shingle * smoothstep(cfg.waterLevel - 0.18, cfg.waterLevel + 0.45, h) * 0.62);
      c.lerp(cWetStone, bank * (1 - shingle) * 0.24);
    }
    if (cfg.pathOffset) {
      const meander = Math.sin(z * 0.017) * 2.4 + Math.sin(x * 0.013 + 1.7) * 1.6;
      const pd = Math.abs(distanceToRiver(x, z) - (cfg.pathOffset + meander));
      const mask = (1 - smoothstep(cfg.pathWidth * 0.5, cfg.pathWidth, pd)) * (0.68 + 0.32 * fbm(x * 0.3, z * 0.3, 2));
      c.lerp(cPath, mask * 0.8);
    }
    const pond = look.pond;
    if (pond) {
      const pr = Math.hypot(x - pond.x, z - pond.z);
      const bedMask = 1 - smoothstep(pond.radius * 0.52, pond.radius * 0.96, pr);
      if (bedMask > 0) c.lerp(cPondBed, bedMask * 0.62);
    }
    // 路肩磨损、岸边苔色与片状干草：只改变色，不改变地形/通行。
    if (surface) {
      const basin = cfg.basin;
      const inVillage = basin ? 1 - smoothstep(basin.inner * 0.85, basin.outer, Math.hypot(x - basin.x, z - basin.z)) : 1;
      const wash = fbm(x * surface.patchScale + 21, z * surface.patchScale - 17, 2);
      c.lerp(earth, inVillage * smoothstep(0.44, 0.75, wash) * surface.dryStrength);
      const rd = roadDistance(x, z);
      const shoulder = 1 - smoothstep(road?.width * 0.5 || 0, (road?.width * 0.5 || 0) + surface.shoulderWidth, rd + (wash - 0.5) * surface.edgeBreakup);
      c.lerp(earth, shoulder * surface.wearStrength);
      if (pond) {
        const rim = Math.abs(Math.hypot(x - pond.x, z - pond.z) - pond.radius);
        c.lerp(moss, (1 - smoothstep(0, surface.pondFringe, rim)) * surface.mossStrength);
      }
    }
    // Aspect comes from the unchanged collision field; color only, never displace.
    const d = 1.6;
    const nx = (field.sample(x - d, z) - field.sample(x + d, z)) / (2 * d);
    const nz = (field.sample(x, z - d) - field.sample(x, z + d)) / (2 * d);
    const normalScale = 1 / Math.hypot(nx, 1, nz);
    const pondWetBlend = pond && Number.isFinite(pond.waterY)
      ? 1 - smoothstep(pond.radius * 0.88, pond.radius * 2.05, Math.hypot(x - pond.x, z - pond.z))
      : 0;
    const localWaterLevel = cfg.waterLevel + (pond && Number.isFinite(pond.waterY) ? (pond.waterY - cfg.waterLevel) * pondWetBlend : 0);
    shadeInkGround(c, { normalX: nx * normalScale, normalZ: nz * normalScale, slope, height: h, waterLevel: localWaterLevel, noise: fbm(x * .045 + 19, z * .045 - 8, 2) }, ink);
    // 宋元青绿山水「披麻皴 + 赭石石青石绿设色」：仅作用于 h > 5.6m 的盆地围山与外溪山坡，绝不影响水岸连续性与几何高度
    const pimaStrength = (ink.pimaStrength ?? 0) * (ink.aspectStrength > 0 ? 1 : 0);
    if (pimaStrength > 0 && h > 5.6 && slope > 0.13) {
      const pimaMask = smoothstep(5.6, 11.8, h) * smoothstep(0.13, 0.35, slope) * pimaStrength;
      if (pimaMask > 0.0005) {
        const gradLen = Math.hypot(nx, nz);
        const gx = gradLen > 1e-4 ? nx / gradLen : 0.7071;
        const gz = gradLen > 1e-4 ? nz / gradLen : 0.7071;
        const cx = -gz;
        const cz = gx;
        // 顺坡拉长 4.5 倍的披麻长皴笔触 + 轻微扭动，模拟毛笔中侧锋顺山脉披拂的肌理
        const uAlong = (x * gx + z * gz) * 0.044;
        const uAcross = (x * cx + z * cz) * 0.205;
        const warp = fbm(x * 0.032 - 14.3, z * 0.032 + 9.7, 2) - 0.5;
        const fiberCoarse = fbm(uAlong + 7.1, uAcross + warp * 1.55 - 3.4, 3);
        const fiberFine = fbm(uAlong * 2.15 - 19.2, uAcross * 2.35 + warp * 2.1 + 11.6, 2);
        const fiber = fiberCoarse * 0.64 + fiberFine * 0.36;
        const sunFacing = (nx * normalScale * sunWarmX + nz * normalScale * sunWarmZ);
        const warmConvex = smoothstep(-0.08, 0.42, sunFacing) * smoothstep(0.46, 0.76, fiber);
        const coolGully = smoothstep(-0.38, 0.16, -sunFacing) * (1 - smoothstep(0.32, 0.62, fiber));
        const inkTrough = 1 - smoothstep(0.24, 0.46, fiber);
        // 阳坡凸脊透暖赭石底骨、罩石绿；阴坡凹谷染石青、勾苍黛焦墨皴擦
        c.lerp(cPimaOchre, pimaMask * warmConvex * 0.52);
        c.lerp(cPimaMalachite, pimaMask * smoothstep(0.42, 0.78, fiberCoarse) * 0.46);
        c.lerp(cPimaAzurite, pimaMask * (coolGully * 0.62 + smoothstep(13.0, 22.0, h) * 0.26));
        c.lerp(cPimaInk, pimaMask * inkTrough * smoothstep(0.20, 0.52, slope) * 0.42);
        // 高处陡坡叠淡淡的折带岩层脉络，打破圆滑土坡感
        if (h > 12.0 && slope > 0.24) {
          const strataMask = smoothstep(12.0, 18.5, h) * smoothstep(0.24, 0.48, slope) * pimaStrength;
          const strata = fbm(h * 0.42 + x * 0.016 - z * 0.014, uAcross * 0.28 + 5.2, 2);
          c.lerp(cPimaStrata, strataMask * smoothstep(0.56, 0.80, strata) * 0.44);
        }
      }
    }
    // 大块的草色斑：一片深绿一片浅黄，草地才不像刷了一层漆
    const patch = fbm(x * 0.0075 + 4.3, z * 0.0075 - 9.1, 2) - 0.5;
    c.offsetHSL(patch * 0.014, patch * 0.07, patch * 0.055);
    const mottle = fbm(x * 0.021 + 13.7, z * 0.021 - 4.2, 3) - 0.5;
    const fine = fbm(x * 0.135 + 7.7, z * 0.135 - 3.3, 2) - 0.5;
    const micro = fbm(x * 0.42 - 5.1, z * 0.42 + 2.7, 2) - 0.5;
    c.offsetHSL(
      mottle * 0.03 + fine * 0.028 + micro * 0.016,
      mottle * 0.1 + fine * 0.11 + micro * 0.05,
      mottle * 0.05 + fine * 0.085 + micro * 0.05
    );
    c.r = Math.min(1, Math.max(0, c.r));
    c.g = Math.min(1, Math.max(0, c.g));
    c.b = Math.min(1, Math.max(0, c.b));
    return c;
  };

  const colors = new Float32Array(count * 3);
  const seg = cfg.segments;
  const s = seg + 1;

  for (let iz = 0; iz <= seg; iz++) {
    for (let ix = 0; ix <= seg; ix++) {
      const i = iz * s + ix;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heights[i];

      const hL = heights[iz * s + Math.max(0, ix - 1)];
      const hR = heights[iz * s + Math.min(seg, ix + 1)];
      const hD = heights[Math.max(0, iz - 1) * s + ix];
      const hU = heights[Math.min(seg, iz + 1) * s + ix];
      const slope = Math.sqrt(Math.pow(hR - hL, 2) + Math.pow(hU - hD, 2)) / (2 * field.step);

      groundColor(x, z, h, slope, col);
      const grain = (0.91 + 0.11 * fbm(x * 0.09, z * 0.09, 2)) * (1 + (fbm(x * 0.42 + 91.3, z * 0.42 - 17.9, 2) - 0.5) * 0.16);
      colors[i * 3] = Math.min(1, Math.max(0, col.r * grain));
      colors[i * 3 + 1] = Math.min(1, Math.max(0, col.g * grain));
      colors[i * 3 + 2] = Math.min(1, Math.max(0, col.b * grain));
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: false,
    map: paperTexture(cfg.grainRepeat || 120, 4242)
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  // 让地贴/色斑能取到任意点的地面色
  const colorAt = function (x, z) {
    const h = field.sample(x, z);
    return groundColor(x, z, h, field.slope(x, z), new THREE.Color());
  };
  return { mesh: mesh, field: field, heightAt: heightAt, colorAt: colorAt };
}
// 远山水墨层峦：三层同心宋元山水群峰（主客揖让奇峰 + 三维前伸山脊支脉与凹谷 + 足底无痕消雾），
// 随相机水平平移且不受近雾硬切，晨昏昼夜与风雪天光与 sky.js 空气透视浑然一体。
function circleNoise2(theta, scale, ox, oz) {
  return valueNoise(Math.cos(theta) * scale + ox, Math.sin(theta) * scale + oz);
}

function circleRidged2(theta, scale, ox, oz, sharpness) {
  const n = circleNoise2(theta, scale, ox, oz);
  return Math.pow(Math.max(0, 1 - Math.abs(2 * n - 1)), sharpness);
}

function buildMountainRidgeGeometry(tierIndex, cfg, rand) {
  const segU = 320;
  const segV = 12;
  const span = cfg.outerRadius - cfg.innerRadius;
  const tierTs = [0.05, 0.48, 0.94];
  const tierT = tierTs[tierIndex] ?? 0.5;
  const baseRadius = cfg.innerRadius + span * tierT;
  const hMin = cfg.heightRange[0];
  const hMax = cfg.heightRange[1];
  const minPeak = Math.max(4.5, hMin * (0.09 + tierT * 0.09));
  const maxPeak = Math.min(62.8, (hMax - cfg.sink) * (0.68 + tierT * 0.20) + 14.5);

  const ox0 = rand() * 40 + 3.1, oz0 = rand() * 40 + 7.7;
  const ox1 = rand() * 40 + 11.3, oz1 = rand() * 40 + 15.9;
  const ox2 = rand() * 40 + 19.7, oz2 = rand() * 40 + 23.5;
  const ox3 = rand() * 40 + 29.1, oz3 = rand() * 40 + 31.8;
  const ox4 = rand() * 40 + 37.4, oz4 = rand() * 40 + 41.2;
  const ox5 = rand() * 40 + 47.6, oz5 = rand() * 40 + 53.9;
  const oAsymX = rand() * 30 + 5.4, oAsymZ = rand() * 30 + 9.2;
  const rPhaseA = rand() * Math.PI * 2;
  const rPhaseB = rand() * Math.PI * 2;
  // 每层山脉错位布设 5–6 座宋元主峰群（主客揖让、互不遮掩），拉出陡峭孤峰与平远云坳的节奏
  const tierShift = tierIndex * 0.58;
  const hostPeaks = [
    { az: -2.42 + tierShift, w: 0.24, h: 0.96, skew: 0.34 },
    { az: -1.32 + tierShift, w: 0.20, h: 0.84, skew: -0.32 },
    { az: -0.18 + tierShift, w: 0.26, h: 0.92, skew: 0.28 },
    { az:  0.92 + tierShift, w: 0.22, h: 0.88, skew: -0.36 },
    { az:  2.08 + tierShift, w: 0.25, h: 0.95, skew: 0.30 },
    { az:  2.96 + tierShift, w: 0.18, h: 0.78, skew: -0.26 }
  ];

  // Dawn and dusk solar azimuths keep gentle scenic mountain saddles so low sun sits above cols cleanly
  const dawnAz = Math.atan2(-0.35, 0.72);
  const duskAz = Math.atan2(-0.42, -0.68);
  const azDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const azSigned = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const sunWarmX = 0.78;
  const sunWarmZ = -0.62;

  const thetas = new Float64Array(segU + 1);
  const radii = new Float64Array(segU + 1);
  const crests = new Float64Array(segU + 1);
  const leans = new Float64Array(segU + 1);

  for (let iu = 0; iu <= segU; iu++) {
    const u = (iu % segU) / segU;
    const theta = u * Math.PI * 2;
    thetas[iu] = (iu / segU) * Math.PI * 2;

    const radialWobble =
      Math.sin(theta * 3 + rPhaseA) * (15 + tierT * 9) +
      Math.cos(theta * 6 + rPhaseB) * (8 + tierT * 5) +
      (circleNoise2(theta, 4.2, ox0, oz1) - 0.5) * 18;
    radii[iu] = baseRadius + radialWobble;

    // 非对称山脉扭折：一侧峭壁危耸、一侧长岭舒缓，告别正弦波圆包山
    const asym = (circleNoise2(theta, 2.8 + tierIndex * 0.45, oAsymX, oAsymZ) - 0.5);
    leans[iu] = asym >= 0 ? 1 : -1;
    const thW = theta + asym * 0.20;

    // 主客群峰轮廓：尖耸主峰（一面峭直一面舒缓）+ 客峰陪衬 + 深云坳呼吸留白
    let peakEnv = 0;
    for (let k = 0; k < hostPeaks.length; k++) {
      const pk = hostPeaks[k];
      const sd = azSigned(theta, pk.az);
      const effW = pk.w * (sd * pk.skew >= 0 ? 0.64 : 1.38);
      const q = Math.abs(sd) / effW;
      if (q < 1.35) {
        const spire = Math.pow(Math.max(0, 1 - q / 1.35), 1.55) * pk.h;
        if (spire > peakEnv) peakEnv = spire;
      }
    }

    const massif = Math.pow(
      0.54 * circleNoise2(thW, 1.85 + tierIndex * 0.25, ox0, oz0) +
      0.46 * circleNoise2(thW, 3.35 + tierIndex * 0.35, ox1, oz1),
      1.32
    );
    const rPrimary = circleRidged2(thW, 6.2 + tierIndex * 0.85, ox2, oz2, 1.72);
    const rSecondary = circleRidged2(thW, 12.6 + tierIndex * 1.45, ox3, oz3, 1.92);
    const rCrag = circleRidged2(thW, 23.5 + tierIndex * 2.4, ox4, oz4, 2.15) * (1 - tierT * 0.42);

    const ridgeMix = Math.min(
      1,
      Math.max(
        0,
        peakEnv * (0.46 + 0.34 * rPrimary + 0.14 * rSecondary) +
        massif * (0.18 + 0.24 * rPrimary + 0.14 * rSecondary) +
        0.10 * rCrag
      )
    );

    const dDawn = azDist(theta, dawnAz);
    const dDusk = azDist(theta, duskAz);
    const colDip =
      (dDawn < 0.44 ? 0.46 * Math.pow(Math.cos((dDawn / 0.44) * Math.PI * 0.5), 2) : 0) +
      (dDusk < 0.44 ? 0.46 * Math.pow(Math.cos((dDusk / 0.44) * Math.PI * 0.5), 2) : 0);

    crests[iu] = Math.min(63.2, (minPeak + ridgeMix * (maxPeak - minPeak)) * (1 - colDip));
  }

  const positions = [];
  const colors = [];
  const ridgeInfos = [];
  const indices = [];
  const baseY = -cfg.sink * 0.55;

  for (let iu = 0; iu <= segU; iu++) {
    const theta = thetas[iu];
    const thetaPer = (iu % segU) / segU * Math.PI * 2;
    const radius = radii[iu];
    const crestY = crests[iu];
    const lean = leans[iu];

    const iuPrev = (iu - 1 + segU) % segU;
    const iuNext = (iu + 1) % segU;
    const dCrest = crests[iuNext] - crests[iuPrev];
    const tanX = -Math.sin(thetaPer);
    const tanZ = Math.cos(thetaPer);
    const inX = -Math.cos(thetaPer);
    const inZ = -Math.sin(thetaPer);
    // 山体侧坡朝向阳面（东南暖光）与阴面（西北石青冷影）
    const slopeSign = Math.max(-1, Math.min(1, -dCrest * 0.22));
    const baseAspect = (inX * 0.45 + tanX * slopeSign * 0.85) * sunWarmX + (inZ * 0.45 + tanZ * slopeSign * 0.85) * sunWarmZ;

    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      // 顺山势斜伸的立体支脉（spurRaw > 0 向谷内凸出成山脊，spurRaw < 0 内凹成幽谷藏岚）
      const thDiag = thetaPer + (1 - v) * lean * 0.082;
      const spurRidge = circleRidged2(thDiag, 11.2 + tierIndex * 1.7, ox5, oz5, 1.52);
      const spurRaw = spurRidge * 2 - 1;
      const spurEnv = Math.sin(Math.pow(v, 0.72) * Math.PI);
      const spurProj = spurRaw * spurEnv * (22 - tierT * 10);

      const vCurve = Math.pow(v, 0.86);
      const gullyCarve = spurRaw * spurEnv * (2.5 - tierT * 1.0);
      const y = baseY + (crestY - baseY) * vCurve + gullyCarve;
      const skirt = Math.pow(1 - v, 1.32) * (18 + tierT * 12);
      const r = radius - skirt - spurProj;
      positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);

      const sunFacing = Math.max(-1, Math.min(1, baseAspect + spurRaw * 0.34 * lean));
      ridgeInfos.push(spurRaw * spurEnv, sunFacing, v);

      // 顶点设色：山脚融白雾，中腰阳面透淡赭石绿、阴面与凹谷染苍黛螺青
      const ridgeTint = Math.pow(v, 0.80);
      const mistBase = 0.992;
      const aspectWarm = Math.max(0, sunFacing) * (1 - tierT * 0.55);
      const aspectCool = Math.max(0, -sunFacing) * (1 - tierT * 0.45);
      const spurLift = spurRaw * spurEnv * 0.045 * (1 - tierT * 0.45);

      const crestToneR = 0.76 + tierT * 0.09 + aspectWarm * 0.055 - aspectCool * 0.055 + spurLift;
      const crestToneG = 0.82 + tierT * 0.07 + aspectWarm * 0.038 - aspectCool * 0.032 + spurLift * 0.9;
      const crestToneB = 0.84 + tierT * 0.07 - aspectWarm * 0.020 + aspectCool * 0.028 + spurLift * 0.5;

      const cr = mistBase + (crestToneR - mistBase) * ridgeTint;
      const cg = mistBase + (crestToneG - mistBase) * ridgeTint;
      const cb = mistBase + (crestToneB - mistBase) * ridgeTint;
      colors.push(
        Math.max(0.54, Math.min(1, cr)),
        Math.max(0.58, Math.min(1, cg)),
        Math.max(0.60, Math.min(1, cb))
      );
    }
  }

  const stride = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * stride + iv;
      const b = (iu + 1) * stride + iv;
      const c = (iu + 1) * stride + iv + 1;
      const d = iu * stride + iv + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aRidgeInfo', new THREE.Float32BufferAttribute(ridgeInfos, 3));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createMountains(cfg, landscape = inkLandscape) {
  const group = new THREE.Group();
  group.name = 'mountains';

  let seed = 5150;
  function rand() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const base = new THREE.Color(cfg.color);
  const far = new THREE.Color(cfg.colorFar);
  const paper = new THREE.Color(cfg.fadeColor);
  const tierAlphas = [0.12, 0.50, 0.90];

  for (let tier = 0; tier < tierAlphas.length; tier++) {
    const k = tierAlphas[tier];
    const geo = buildMountainRidgeGeometry(tier, cfg, rand);
    const col = base.clone().lerp(far, k);
    const fade = cfg.fadeNear + k * (cfg.fadeFar - cfg.fadeNear);
    col.lerp(paper, fade);

    const mat = new THREE.MeshBasicMaterial({
      color: col,
      vertexColors: true,
      fog: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mountain-tier-' + tier;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  const haze = createMountainHaze(group.children.map(mesh => mesh.material), landscape.mountains);
  const createdCols = group.children.map(mesh => mesh.material.color.clone());
  const mtn = landscape.mountains || {};
  const noonCols = (Array.isArray(mtn.noonTiers) && mtn.noonTiers.length === 3 ? mtn.noonTiers : ['#6A877F', '#8EA59F', '#B6C8C5']).map(hex => new THREE.Color(hex));
  const noonStrength = mtn.noonStrength ?? 0.85;
  const noonRainDamp = mtn.noonRainDamp ?? 0.6;
  let noonAmt = 0;
  const sMtn = phenologySeasons.mountains || {};
  const summerCols = (Array.isArray(sMtn.summerTiers) && sMtn.summerTiers.length === 3 ? sMtn.summerTiers : ['#568272', '#749C8C', '#9DC0B2']).map(hex => new THREE.Color(hex));
  const autumnCols = (Array.isArray(sMtn.autumnTiers) && sMtn.autumnTiers.length === 3 ? sMtn.autumnTiers : ['#8E7A64', '#AA9A86', '#C6BDB0']).map(hex => new THREE.Color(hex));
  const snowCols = (Array.isArray(mtn.winterTiers) && mtn.winterTiers.length === 3 ? mtn.winterTiers : (Array.isArray(sMtn.winterTiers) && sMtn.winterTiers.length === 3 ? sMtn.winterTiers : ['#DCE4E6', '#E6ECEE', '#F0F4F4'])).map(hex => new THREE.Color(hex));
  const summerStrength = sMtn.summerStrength ?? 0.68;
  const autumnStrength = sMtn.autumnStrength ?? 0.68;
  const winterStrength = sMtn.winterStrength ?? 0.75;
  const _tierCol = new THREE.Color();
  let summerAmt = 0;
  let summerTarget = 0;
  let autumnAmt = 0;
  let autumnTarget = 0;
  let winterAmt = 0;
  let winterTarget = 0;
  group.setPhenology = function (id) {
    summerTarget = id === 'summer' ? 1 : 0;
    autumnTarget = id === 'autumn' ? 1 : 0;
    winterTarget = id === 'winter' ? 1 : 0;
  };
  const hazeUpdate = haze.update;
  // 正午远山三层色阶 + 晨昏夜雨雪空气透视联动：已注册 sky 时通过 setMaterialBaseColor 走天光与雾消隐，避免黄昏/黑夜远山反亮成纸片
  group.update = function (dt, sky, cam) {
    hazeUpdate(dt, sky, cam);
    if (haze.disposed) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const tid = sky && typeof sky.timeId === 'string' ? sky.timeId : '';
    const base = tid === 'day' ? 1 : (tid === 'dawn' || tid === 'dusk') ? 0.25 : 0;
    const rain = Number.isFinite(sky && sky.rainIntensity) ? sky.rainIntensity : 0;
    const snow = Number.isFinite(sky && sky.snowIntensity) ? sky.snowIntensity : 0;
    const precip = Math.min(1, Math.max(0, rain + snow * 0.85));
    const target = base * (1 - precip * noonRainDamp);
    const rate = Math.min(1, dt * 1.6);
    noonAmt += (target - noonAmt) * rate;
    const w = noonAmt * noonStrength;
    summerAmt += (summerTarget - summerAmt) * rate;
    autumnAmt += (autumnTarget - autumnAmt) * rate;
    winterAmt += (winterTarget - winterAmt) * rate;
    const suw = summerAmt * summerStrength;
    const auw = autumnAmt * autumnStrength;
    const sw = winterAmt * winterStrength;
    haze.setWinter?.(sw);
    for (let i = 0; i < group.children.length; i++) {
      _tierCol
        .copy(createdCols[i])
        .lerp(noonCols[i], w)
        .lerp(summerCols[i], suw)
        .lerp(autumnCols[i], auw)
        .lerp(snowCols[i], sw);
      if (!(sky && typeof sky.setMaterialBaseColor === 'function' && sky.setMaterialBaseColor(group.children[i].material, _tierCol))) {
        group.children[i].material.color.copy(_tierCol);
      }
    }
  };
  group.getStats = haze.getStats;
  group.getCloudState = haze.getCloudState;
  group.dispose = function () {
    if (haze.disposed) return;
    haze.dispose();
    for (const mesh of group.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
    group.removeFromParent();
  };
  return group;
}