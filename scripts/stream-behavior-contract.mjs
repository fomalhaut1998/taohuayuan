import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createStream, createRiverCurve, sampleRiverSpine } from '../src/world/stream.js';

// Historical source is immutable evidence, not a source-file byte lock on refinements.
export async function assertStreamBehavior(baseline = '.visual-round5-baseline/src/world/stream.js') {
  const baselineUrl = new URL('../' + baseline, import.meta.url);
  const source = await readFile(baselineUrl, 'utf8');
  const imported = source.replace(/from\s+(['"])([^'"]+)\1/g, (full, quote, specifier) => {
    // Historical snapshots save the water file only; both versions share the independently verified terrain contract.
    const absolute = specifier.startsWith('.') ? new URL(specifier, new URL('../src/world/stream.js', import.meta.url)).href : import.meta.resolve(specifier);
    return 'from ' + quote + absolute + quote;
  });
  const old = await import('data:text/javascript;base64,' + Buffer.from(imported).toString('base64'));
  const world = JSON.parse(await readFile(new URL('../src/data/world.json', import.meta.url), 'utf8'));
  const previousDocument = globalThis.document;
  const ctx = new Proxy({}, { get: () => () => ctx });
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  try {
    const curve = createRiverCurve(world.stream.points);
    const oldCurve = old.createRiverCurve(world.stream.points);
    assert.deepEqual(sampleRiverSpine(curve, 160), old.sampleRiverSpine(oldCurve, 160), 'same shared river spine');
    for (const candidate of [curve, new THREE.CatmullRomCurve3([new THREE.Vector3(-35,0,20), new THREE.Vector3(0,0,0), new THREE.Vector3(33,0,-24)])]) {
      const a = createStream(world.stream, world.terrain, candidate);
      const b = old.createStream(world.stream, world.terrain, candidate);
      assert.equal(a.length,b.length,'same curve length');
      assert.deepEqual(a.mesh.geometry.index.array,b.mesh.geometry.index.array,'same winding/topology');
      for (const name of ['position','normal','uv']) assert.deepEqual(a.mesh.geometry.attributes[name].array,b.mesh.geometry.attributes[name].array,'same initial '+name);
      for (const key of ['opacity','transparent','depthWrite','side']) assert.equal(a.mesh.material[key],b.mesh.material[key],'same water '+key);
      assert.equal(a.mesh.material.isMeshLambertMaterial,true,'Lambert, not PBR');
      for (const t of [0,.03,.25,.5,.94,1]) for (const clock of [0,.7,8,90]) assert.equal(a.surfaceY(t,clock),b.surfaceY(t,clock),'shared public wave height');
      for (const elapsed of [.2,1.75,12.2]) {
        a.update(.016,elapsed);b.update(.016,elapsed);
        assert.deepEqual(a.mesh.geometry.attributes.position.array,b.mesh.geometry.attributes.position.array,'same live wave vertices');
      }
      const positions=a.mesh.geometry.attributes.position.array.slice();
      const offset=a.mesh.material.map.offset.clone();
      a.update(0,999);
      assert.deepEqual(a.mesh.geometry.attributes.position.array,positions,'dt=0 cannot advance waves');
      assert(a.mesh.material.map.offset.equals(offset),'dt=0 cannot scroll water');
      for (const s of [a,b]) {s.mesh.geometry.dispose();s.mesh.material.map?.dispose();s.mesh.material.dispose();}
    }
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
  return true;
}
