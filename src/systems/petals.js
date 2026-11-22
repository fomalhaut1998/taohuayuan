import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPetals(cfg, field) {
  const rand = mulberry32(776611);
  const count = cfg.count;

  const geo = new THREE.PlaneGeometry(cfg.size, cfg.size * 0.7);
  const mat = new THREE.MeshBasicMaterial({
    color: cfg.color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.96
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'petals';
  mesh.frustumCulled = false;

  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const phase = new Float32Array(count);
  const spin = new Float32Array(count);
  const fall = new Float32Array(count);

  function place(i, cx, cy, cz, initial) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * cfg.radius;
    px[i] = cx + Math.cos(a) * r;
    pz[i] = cz + Math.sin(a) * r;
    py[i] = initial ? cy + rand() * cfg.height : cy + cfg.height * (0.72 + rand() * 0.28);
    phase[i] = rand() * Math.PI * 2;
    spin[i] = 0.6 + rand() * cfg.spin;
    fall[i] = cfg.fallSpeed * (0.7 + rand() * 0.6);
  }

  const dummy = new THREE.Object3D();

  function fill(cx, cy, cz) {
    for (let i = 0; i < count; i++) place(i, cx, cy, cz, true);
  }

  function update(dt, elapsed, cx, cy, cz, windX, windZ) {
    const r2 = cfg.radius * cfg.radius * 2.56;
    const wx = (windX || 0) * dt;
    const wz = (windZ || 0) * dt;
    for (let i = 0; i < count; i++) {
      py[i] -= fall[i] * dt;
      px[i] += Math.cos(elapsed * cfg.swirlSpeed + phase[i]) * cfg.swirlRadius * dt + wx;
      pz[i] += Math.sin(elapsed * cfg.swirlSpeed * 1.27 + phase[i] * 1.7) * cfg.swirlRadius * dt + wz;

      const dx = px[i] - cx;
      const dz = pz[i] - cz;
      if (py[i] < field.sample(px[i], pz[i]) - 0.4 || dx * dx + dz * dz > r2) {
        place(i, cx, cy, cz, false);
      }

      dummy.position.set(px[i], py[i], pz[i]);
      dummy.rotation.set(
        elapsed * spin[i] * 0.8 + phase[i],
        phase[i] + elapsed * spin[i] * 0.55,
        phase[i] * 0.6
      );
      dummy.scale.setScalar(0.85 + (i % 7) * 0.04);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh: mesh, fill: fill, update: update, count: count };
}
// 落英：铺在桃树下的地面花瓣（静态，一次摆好）
export function createFallenPetals(cfg, field, spots, curve, waterLevel) {
  const rand = mulberry32(918273);
  const count = cfg.count;

  const geo = new THREE.PlaneGeometry(1, 0.72);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'fallen-petals';
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = cfg.colors.map(function (c) { return new THREE.Color(c); });

  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 12) {
    guard++;
    let x;
    let z;
    if (rand() < (cfg.bandRatio || 0.5)) {
      const tt = rand();
      const p = curve.getPointAt(tt);
      const tan = curve.getTangentAt(tt);
      const nl = Math.hypot(tan.x, tan.z) || 1;
      const side = rand() < 0.5 ? -1 : 1;
      const off = cfg.bandInner + rand() * (cfg.bandOuter - cfg.bandInner);
      x = p.x + (tan.z / nl) * off * side;
      z = p.z - (tan.x / nl) * off * side;
    } else {
      const s = spots[Math.floor(rand() * spots.length)];
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * cfg.spread;
      x = s[0] + Math.cos(a) * r;
      z = s[2] + Math.sin(a) * r;
    }
    const h = field.sample(x, z);
    if (h < waterLevel + 0.15) continue;

    const size = cfg.sizeRange[0] + rand() * (cfg.sizeRange[1] - cfg.sizeRange[0]);
    dummy.position.set(x, h + 0.05, z);
    dummy.rotation.set((rand() - 0.5) * 0.22, rand() * Math.PI * 2, (rand() - 0.5) * 0.22);
    dummy.scale.set(size, size, size);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    color.copy(palette[Math.floor(rand() * palette.length)]);
    color.offsetHSL(0, 0, (rand() - 0.5) * 0.05);
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh: mesh, count: placed };
}