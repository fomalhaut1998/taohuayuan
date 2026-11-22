import * as THREE from 'three';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createAvatar } from '../src/player/avatar.js';
import { makeHead, makeHat, makePeopleParts } from '../src/character-parts.js';

const root = new URL('../src/data/world.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(root, 'utf8'));
const pcfg = data.player.avatar;
const vcfg = data.people;

const W = Number(process.argv[2] || 900);
const H = Number(process.argv[3] || 900);
const outFile = process.argv[4] || 'preview.png';
const scene = process.argv[5] || 'face';

function collect(object) {
  object.updateMatrixWorld(true);
  const tris = [];
  object.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const base = o.material && o.material.color ? o.material.color : new THREE.Color('#ffffff');
    const m = o.matrixWorld;
    const count = pos.count;
    for (let i = 0; i < count; i += 3) {
      const v = [];
      const c = [];
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(m);
        v.push(p);
        if (col) c.push(new THREE.Color(col.getX(i + k), col.getY(i + k), col.getZ(i + k)));
        else c.push(base.clone());
      }
      tris.push({ v, c });
    }
  });
  return tris;
}

const L = new THREE.Vector3(0.42, 0.86, 0.72).normalize();
const L2 = new THREE.Vector3(-0.55, 0.25, -0.7).normalize();

function shade(n, c) {
  const d = Math.max(0, n.dot(L));
  const b = Math.max(0, n.dot(L2)) * 0.16;
  const k = 0.40 + 0.70 * d + b;
  return [Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k)];
}

function render(tris, camPos, target, fov, file) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.01, 60);
  cam.position.copy(camPos);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const view = cam.matrixWorldInverse;
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
  const depth = new Float32Array(W * H).fill(Infinity);
  const buf = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = 232; buf[i * 3 + 1] = 228; buf[i * 3 + 2] = 219;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  let drawn = 0;
  for (const t of tris) {
    a.copy(t.v[0]); b.copy(t.v[1]); c.copy(t.v[2]);
    e1.subVectors(b, a); e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-14) continue;
    n.normalize();
    const za = a.clone().applyMatrix4(view).z;
    const zb = b.clone().applyMatrix4(view).z;
    const zc = c.clone().applyMatrix4(view).z;
    if (za > -0.02 || zb > -0.02 || zc > -0.02) continue;
    const pa = a.clone().applyMatrix4(vp), pb = b.clone().applyMatrix4(vp), pc = c.clone().applyMatrix4(vp);
    const ax = (pa.x * 0.5 + 0.5) * W, ay = (1 - (pa.y * 0.5 + 0.5)) * H;
    const bx = (pb.x * 0.5 + 0.5) * W, by = (1 - (pb.y * 0.5 + 0.5)) * H;
    const cx = (pc.x * 0.5 + 0.5) * W, cy = (1 - (pc.y * 0.5 + 0.5)) * H;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minX > maxX || minY > maxY) continue;
    const rgb = shade(n, t.c[0]);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
        const w1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = 1 / (w2 / -za + w1 / -zb + w0 / -zc);
        const idx = y * W + x;
        if (z >= depth[idx]) continue;
        depth[idx] = z;
        buf[idx * 3] = Math.pow(rgb[0], 1 / 2.2) * 255;
        buf[idx * 3 + 1] = Math.pow(rgb[1], 1 / 2.2) * 255;
        buf[idx * 3 + 2] = Math.pow(rgb[2], 1 / 2.2) * 255;
      }
    }
    drawn++;
  }
  writePng(file, buf, W, H);
  return drawn;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(file, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy ? null : null;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

const tests = {
  avatar() {
    const av = createAvatar(pcfg, 2.4);
    return collect(av.group);
  },
  face() {
    const g = new THREE.Group();
    const head = makeHead({ ...pcfg, elderHair: pcfg.hair, jade: pcfg.clothes2, mouth: pcfg.mouth });
    const h = new THREE.Mesh(head, new THREE.MeshLambertMaterial({ vertexColors: true }));
    g.add(h);
    const hat = new THREE.Mesh(makeHat(pcfg, 1.02), new THREE.MeshLambertMaterial({ vertexColors: true }));
    hat.position.y = 0;
    g.add(hat);
    return collect(g);
  },
  villagerFull() { return this.villager(); },
  villagerHero() { return this.villager(); },
  villagerBack() { return this.villager(); },
  villagerSide() { return this.villager(); },
  childBust() { return collect(this.villagerGroup('child', false)); },
  villagerBust() {
    const g = this.villagerGroup('adult', true);
    return collect(g);
  },
  backBust() {
    const parts = makePeopleParts(vcfg);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const h = new THREE.Mesh(parts.head, mat); h.position.y = 1.40; g.add(h);
    const hat = new THREE.Mesh(parts.hat, mat); hat.position.y = 1.40; g.add(hat);
    return collect(g);
  },
  elderBust() {
    const parts = makePeopleParts(vcfg);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const mh = new THREE.Mesh(parts.elderHead, mat); mh.position.y = 1.36; g.add(mh);
    const mhat = new THREE.Mesh(parts.hat, mat); mhat.position.y = 1.36; g.add(mhat);
    const torso = new THREE.Mesh(parts.robe, mat);
    torso.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, color: new THREE.Color(vcfg.clothes[1]) });
    torso.position.y = 0.285 + 0.70; g.add(torso);
    return collect(g);
  },
  family() {
    const g = new THREE.Group();
    const specs = [['adult', 1, 0, true], ['elder', 0.95, 1, true], ['child', 0.62, 2, false]];
    for (const [role, sc, i, hasHat] of specs) {
      const one = this.villagerGroup(role, hasHat);
      one.scale.setScalar(sc);
      one.position.x = (i - 1) * 0.62 * sc;
      g.add(one);
    }
    return collect(g);
  },
  villager(role = 'adult', hasHat = true) {
    const g = this.villagerGroup(role, hasHat);
    return collect(g);
  },
  villagerGroup(role = 'adult', hasHat = true) {
    const parts = makePeopleParts({ ...vcfg, elderHair: vcfg.elderHair, jade: vcfg.jade, sash: vcfg.sash, mouth: vcfg.mouth, eye: vcfg.eye, lip: vcfg.lip, earShade: vcfg.earShade });
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const bodyCol = new THREE.Color(vcfg.clothes[1]);
    const mk = (geo, col) => {
      const geo2 = geo.clone();
      if (col && !geo2.attributes.color) {
        const c = new THREE.Color(col);
        const cnt = geo2.attributes.position.count;
        const arr = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { arr[i*3]=c.r; arr[i*3+1]=c.g; arr[i*3+2]=c.b; }
        geo2.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
      }
      return new THREE.Mesh(geo2, mat);
    };
    const robe = mk(parts.robe, bodyCol); robe.position.y = 0.285; g.add(robe);
    const trim = mk(parts.trim); trim.position.y = 0.285; g.add(trim);
    const headGeo = role === 'elder' ? parts.elderHead : role === 'child' ? parts.childHead : parts.head;
    const head = mk(headGeo); head.position.y = 0.705; g.add(head);
    if (hasHat) { const hat = mk(parts.hat); hat.position.y = 0.705; g.add(hat); }
    for (const side of [-1, 1]) {
      const arm = mk(parts.sleeve, bodyCol);
      arm.position.set(side * 0.196, 0.435, 0);
      arm.rotation.z = side * 0.08;
      g.add(arm);
      const cuff = mk(parts.cuff);
      cuff.position.copy(arm.position); cuff.rotation.copy(arm.rotation);
      g.add(cuff);
      const leg = mk(parts.leg, vcfg.pants[0]);
      leg.position.set(side * 0.092, 0, 0);
      leg.scale.set(1, 0.72, 1);
      g.add(leg);
      const shoe = mk(parts.shoe);
      shoe.position.set(side * 0.092, -0.72, 0);
      g.add(shoe);
    }
    return g;
  },
  bust() {
    const g = new THREE.Group();
    const head = makeHead({ ...pcfg, elderHair: pcfg.hair, jade: pcfg.clothes2, mouth: pcfg.mouth });
    g.add(new THREE.Mesh(head, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const hat = new THREE.Mesh(makeHat(pcfg, 1.02), new THREE.MeshLambertMaterial({ vertexColors: true }));
    g.add(hat);
    return collect(g);
  },
  heads() {
    const g = new THREE.Group();
    const list = [['adult', 0], ['elder', 0], ['child', 0]];
    const spec = [
      { ...vcfg, elderHair: vcfg.elderHair, jade: vcfg.jade, sash: vcfg.sash, mouth: vcfg.mouth },
      { ...vcfg, elderHair: vcfg.elderHair, jade: vcfg.jade, sash: vcfg.sash, mouth: vcfg.mouth },
      { ...vcfg, elderHair: vcfg.elderHair, jade: vcfg.jade, sash: vcfg.sash, mouth: vcfg.mouth }
    ];
    for (let i = 0; i < 3; i++) {
      const geo = makeHead(spec[i], list[i][0]);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.position.x = (i - 1) * 0.30;
      g.add(m);
    }
    return collect(g);
  }
};

const tris = tests[scene]();
const views = {
  avatar: [[1.5, 2.05, 3.3], [0, 1.12, 0], 24],
  face: [[0.05, 0.02, 0.52], [0, -0.01, 0], 32],
  bust: [[0.22, 0.14, 0.86], [0, 0.02, 0], 30],
  heads: [[0.30, 0.10, 1.05], [0, 0.0, 0], 32],
  villager: [[1.55, 1.35, 3.05], [0, 0.92, 0], 34],
  villagerFull: [[1.9, 1.6, 3.9], [0, 0.66, 0], 40],
  family: [[1.46, 1.30, 2.96], [0, 0.56, 0], 38],
  villagerBack: [[2.2, 1.5, -2.6], [0, 0.85, 0], 34],
  elderBust: [[0.34, 1.52, 0.62], [0, 1.36, 0], 30],
  backBust: [[0.30, 1.95, -0.62], [0, 1.42, 0], 30],
  villagerBust: [[0.30, 0.86, 0.72], [0, 0.78, 0], 30],
  childBust: [[0.26, 0.80, 0.60], [0, 0.74, 0], 30],
  villagerSide: [[2.65, 1.55, 0.20], [0, 0.78, 0], 36],
  villagerHero: [[1.62, 1.62, 2.78], [0, 0.95, 0], 32]
}[scene];
const drawn = render(tris, new THREE.Vector3(...views[0]), new THREE.Vector3(...views[1]), views[2], outFile);
console.log(JSON.stringify({ scene, tris: tris.length, drawn, outFile }));
