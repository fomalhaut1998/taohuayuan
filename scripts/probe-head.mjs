import * as THREE from 'three';
import { makePeopleParts } from '../src/character-parts.js';
import fs from 'node:fs';
const world = JSON.parse(fs.readFileSync(new URL('../src/data/world.json', import.meta.url),'utf8'));
const parts = makePeopleParts(world.people);
const box = new THREE.Box3();
for (const [k,g] of Object.entries(parts)) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  console.log(k.padEnd(10), 'y', b.min.y.toFixed(3), b.max.y.toFixed(3), '| x', b.min.x.toFixed(3), b.max.x.toFixed(3), '| z', b.min.z.toFixed(3), b.max.z.toFixed(3));
}
const s = 1;
const hipY = 0, torsoY = 0.285;
console.log('robe world top', (torsoY + parts.robe.boundingBox.max.y).toFixed(3), 'head center', 0.705, 'head bottom', (0.705 + parts.head.boundingBox.min.y).toFixed(3));
