import * as THREE from 'three';

// Two small glowing windows per house; one instanced draw, no per-house lights.
export function createHouseLight(houses) {
  const material = new THREE.MeshLambertMaterial({ color: '#534330', emissive: '#ffad50', emissiveIntensity: 0, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, houses.length * 2);
  mesh.name = 'house-windows';
  const dummy = new THREE.Object3D();
  houses.forEach(function (h, i) {
    for (let side = 0; side < 2; side++) {
      const localX = (side ? 1 : -1) * h.w * 0.29;
      const front = h.d * 0.5 + 0.065;
      dummy.position.set(h.x + Math.cos(h.rot) * localX + Math.sin(h.rot) * front, h.gy + h.h * 0.56, h.z - Math.sin(h.rot) * localX + Math.cos(h.rot) * front);
      dummy.rotation.set(0, h.rot, 0); dummy.scale.set(0.68, 0.73, 1); dummy.updateMatrix();
      mesh.setMatrixAt(i * 2 + side, dummy.matrix);
    }
  });
  let amount = 0;
  return { mesh, update(dt, time) { const target = time === 'night' ? 1 : time === 'dusk' ? 0.62 : 0; amount += (target - amount) * (1 - Math.exp(-dt * 0.8)); material.emissiveIntensity = amount * 1.5; }, get intensity() { return amount; } };
}
