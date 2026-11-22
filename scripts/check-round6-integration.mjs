import assert from 'node:assert/strict';
import { assertStreamBehavior } from './stream-behavior-contract.mjs';
import { readFile } from 'node:fs/promises';
import { ROUND6_BLOCKS, stripRound6Main } from './round6-main-delta.mjs';
import { CATALOGUE } from '../src/systems/catalogue.js';
import { collectDiscoveryTargets, resolveDiscoveryTarget } from '../src/systems/discovery-targets.js';
import { installSkyAppearance, isSkyAppearanceMaterial, skyDesaturation } from '../src/systems/scene-appearance.js';
const text=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const main=await text('src/main.js');
for(const name of ROUND6_BLOCKS) {
  const begin='// Round 6: '+name+' begin';
  const end='// Round 6: '+name+' end';
  assert.equal(main.split(begin).length-1,1,'exactly one audited addition block: '+begin);
  assert.equal(main.split(end).length-1,1,'exactly one audited addition block: '+end);
  assert(main.indexOf(begin)<main.indexOf(end),'ordered block markers: '+name);
}
const stripped=stripRound6Main(main);
for(const core of ['createPlayer','createVillage','createSky','createSound','createJournal','createMap','optimizeStaticVisibility']){
  assert(stripped.includes(core),'core initialization survives round6 block stripping: '+core);
}
await assertStreamBehavior('.visual-round6-baseline/src/world/stream.js');
for(const path of ['src/data/world.json']) {
  assert.equal(await text(path),await text('.visual-round6-baseline/'+path),'protected unchanged source '+path);
}
assert.equal(typeof installSkyAppearance,'function');
assert.equal(typeof isSkyAppearanceMaterial,'function');
assert.equal(skyDesaturation('clear_noon'),0);
const at=s=>{const p=main.indexOf(s);assert(p>=0,'missing '+s);return p;};
assert(at('const pondLife = createPondLife(')<at('const colliders ='));
assert(at('const waterworks = createWaterworks(')<at('const colliders ='));
assert(at('const leisureGrove = createLeisureGrove(')<at('const colliders ='));
assert(at('const communityLife = createCommunityLife(')<at('const sky = createSky('));
assert(main.includes('exterior.blockers, pondLife.blockers, waterworks.blockers, leisureGrove.blockers)'));
assert(main.includes('reservations: [pondLife, waterworks]'));
assert(main.includes('  pondLife, waterworks, leisureGrove,'));
for(const name of ['pondLife','waterworks','leisureGrove','communityLife']) {
  assert.equal((main.match(new RegExp(name+'[.]update[(]','g'))||[]).length,1,'only one normal update '+name);
  assert(at(name+'.update(')>at('sound.update(dt, elapsed, camera, player.state, false)'));
  assert(at(name+'.update(')>at('elapsed += dt;'));
}
const oldCatalogue = await import('../.visual-round6-baseline/src/systems/catalogue.js');
for(const [id,entry] of Object.entries(oldCatalogue.CATALOGUE)) assert.deepEqual(CATALOGUE[id],entry,'old journal id/content '+id);
const ids=['duckweed','lotus','dragonfly','carp','shrimp','pond-watergrass','lotus-rhizome','freshwater-mussel','laundry-stone','harvest-tub','waterwheel','bamboo-irrigation','water-mortar','fish-trap','thatched-pavilion','liubo-board','social-tree','shrine-stone','timber-footbridge','bamboo-shoot','bamboo-conduit','plum-tree','chestnut-tree','bee-barrel'];
for(const id of ids) assert(CATALOGUE[id]?.text.length>10,'new actual-scene catalogue '+id);
const dynamic={id:'carp',x:1,y:2,z:3,range:6,resolve:()=>({x:4,y:5,z:6})};
const fixture={pondLife:{targets:[dynamic,{id:'invented',x:1,y:2,z:3},{id:'lotus',x:NaN,y:2,z:3}]},waterworks:{targets:[{id:'waterwheel',x:8,y:9,z:10,range:7}]},leisureGrove:{targets:[{id:'bee-barrel',x:11,y:12,z:13,range:5}]}};
const targets=collectDiscoveryTargets(fixture);
assert.equal(targets.length,3,'only built, known, finite anchors');
assert.deepEqual(targets.map(p=>p.source),['pond-life','waterworks','leisure-grove']);
assert.deepEqual([resolveDiscoveryTarget(targets[0]).x,resolveDiscoveryTarget(targets[0]).y,resolveDiscoveryTarget(targets[0]).z],[4,5,6],'live animal resolver preserved');
assert(targets.every(p=>!p.ownBlocker),'no arbitrary structural LOS exemption imported');
assert.deepEqual(collectDiscoveryTargets(),[]);
console.log('PASS round6 exact additive wiring, unchanged old world/actors/audio/time, existing catalogue, real-source targets and freeze order');
