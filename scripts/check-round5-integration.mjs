import assert from 'node:assert/strict';
import { assertStreamBehavior } from './stream-behavior-contract.mjs';
import { readFile } from 'node:fs/promises';
const text = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const [main, config, oldConfig] = await Promise.all([
  text('src/main.js'),
  text('src/data/world.json'),
  text('.visual-round5-baseline/src/data/world.json')
]);
assert.equal(config, oldConfig, 'all accepted world, day/night, actor and save config remains byte-identical');
await assertStreamBehavior('.visual-round5-baseline/src/world/stream.js');
const at = value => { const p = main.indexOf(value); assert(p >= 0, 'missing ' + value); return p; };
assert(main.includes("import { createWaterSurface } from './systems/twilight-water.js';"), 'twilight water adapter imported');
assert(at('const twilightWater = createWaterSurface(stream.mesh, sky,') > at('const sky = createSky('));
assert(at('twilightWater.update(dt)') > at('sky.update(dt, camera)'));
assert(at('twilightWater.update(dt)') > at('elapsed += dt;'));
assert.equal((main.match(/twilightWater[.]update/g) || []).length, 1, 'exactly one normal clock, no paused update');
assert(at('const twilightWater = createWaterSurface(stream.mesh, sky,') < at('const staticVisibility = optimizeStaticVisibility(scene'));
assert(/window\.__APP__[\s\S]*twilightWater/.test(main), 'twilightWater exposed on debug handle');
console.log(JSON.stringify({round5Integration:true,worldAndWaterUnchanged:true,mainOnlyWaterAdapter:true,normalClockOnly:true}));
