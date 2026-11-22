import * as THREE from 'three';
import { chokeFactor } from './terrain.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 程序化水纹：Canvas 画横竖条纹，不引入任何位图资源
function makeWaterTexture(size, seed) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const rand = lcg(seed);

  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 280; i++) {
    const y = rand() * size;
    const x0 = rand() * size;
    const len = size * (0.25 + rand() * 0.7);
    const alpha = 0.05 + rand() * 0.13;
    ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 0.7 + rand() * 2.1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.bezierCurveTo(x0 + len * 0.33, y - 2.5, x0 + len * 0.66, y + 2.5, x0 + len, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRiverCurve(points) {
  const pts = points.map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); });
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
}

// 把曲线密采样成折线：地形的河槽与水面必须用同一条中轴，否则岸会一边宽一边窄
export function sampleRiverSpine(curve, count) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const p = curve.getPointAt(i / count);
    out.push([p.x, p.z]);
  }
  return out;
}

export function createStream(cfg, terrainCfg, curve) {
  const length = curve.getLength();
  const N = cfg.segments;
  const vertCount = (N + 1) * 2;
  const y = terrainCfg.waterLevel;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const baseY = new Float32Array(vertCount);
  const flow = new Float32Array(vertCount);

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nl = Math.hypot(tan.x, tan.z) || 1;
    const nx = tan.z / nl;
    const nz = -tan.x / nl;
    const half = (cfg.halfWidth + Math.sin(t * 21.7) * cfg.edgeWobble) * chokeFactor(terrainCfg, p.x, p.z);

    const li = i * 2;
    const ri = i * 2 + 1;

    positions[li * 3] = p.x + nx * half;
    positions[li * 3 + 1] = y;
    positions[li * 3 + 2] = p.z + nz * half;

    positions[ri * 3] = p.x - nx * half;
    positions[ri * 3 + 1] = y;
    positions[ri * 3 + 2] = p.z - nz * half;

    const v = t * (length / 8);
    uvs[li * 2] = 0;
    uvs[li * 2 + 1] = v;
    uvs[ri * 2] = 1;
    uvs[ri * 2 + 1] = v;

    baseY[li] = y;
    baseY[ri] = y;
    flow[li] = t;
    flow[ri] = t;
  }

  const indices = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const tex = makeWaterTexture(cfg.textureSize, 20260118);
  // 水面写深会让水下的鱼/船体被完全遮死：只参与混色，不写深度
  const mat = new THREE.MeshLambertMaterial({
    color: cfg.color,
    map: tex,
    transparent: true,
    opacity: cfg.opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stream';
  mesh.renderOrder = 1;

  // 水面高度：鱼、船、涟漪都按同一个公式骑在浪上，避免各自算各自的
  function surfaceY(t, elapsed) {
    return y + Math.sin(t * 34 + elapsed * cfg.waveSpeed * 2) * cfg.waveAmp;
  }

  function update(dt, elapsed) {
    // Pause is authoritative: do not accept a different external clock at dt=0.
    if (!Number.isFinite(dt) || dt <= 0) return;
    tex.offset.y -= dt * cfg.scrollSpeed;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < vertCount; i++) {
      arr[i * 3 + 1] = surfaceY(flow[i], elapsed);
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { mesh: mesh, curve: curve, length: length, surfaceY: surfaceY, update: update };
}