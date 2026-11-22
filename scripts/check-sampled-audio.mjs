import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSampleAudio, resolveSampleUrl } from '../src/systems/sample-audio.js';

// Scheduling/lifecycle evidence, NOT an acoustic-realism or human-listening evaluation.
let tests = 0;
async function check(name, test) { await test(); tests++; console.log('PASS', name); }
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); }
  setTargetAtTime(value, at, tc) { this.value = value; this.events.push(['target', value, at, tc]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push(['linear', value, at]); }
  exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push(['exponential', value, at]); }
}
class Node {
  constructor(kind) { this.kind = kind; this.links = []; this.disconnected = false; this.gain = new Param(1); this.frequency = new Param(440); this.Q = new Param(); this.pan = new Param(); this.playbackRate = new Param(1); }
  connect(node) { this.links.push(node); return node; }
  disconnect() { this.links = []; this.disconnected = true; }
  start(...args) { this.startArgs = args; this.playedBuffer = this.buffer; }
  stop() { this.stopped = true; this.end(); }
  end() { this.onended?.(); }
}
class Context {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.nodes = []; this.sampleRate = 1000; this.destination = new Node('output'); this.resumes = 0; this.decodes = 0; }
  node(kind) { const n = new Node(kind); this.nodes.push(n); return n; }
  createBufferSource() { return this.node('source'); }
  createGain() { return this.node('gain'); }
  createBiquadFilter() { return this.node('filter'); }
  createStereoPanner() { return this.node('pan'); }
  createConvolver() { return this.node('convolver'); }
  createOscillator() { return this.node('oscillator'); }
  createDynamicsCompressor() { const n = this.node('compressor'); for (const key of ['threshold','knee','ratio','attack','release']) n[key] = new Param(); return n; }
  createAnalyser() { const n = this.node('analyser'); n.getByteTimeDomainData = a => a.fill(128); n.getByteFrequencyData = a => a.fill(0); n.frequencyBinCount = 1024; return n; }
  createBuffer(channels, length, rate) { return { duration: length / rate, length, numberOfChannels: channels, getChannelData: () => new Float32Array(length) }; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  async decodeAudioData(bytes) { this.decodes++; return { duration: 3, length: 3000, numberOfChannels: 1, id: new Uint8Array(bytes)[0] }; }
  sources() { return this.nodes.filter(n => n.kind === 'source' && !n.loop); }
}
const clips = [
  { id:'ack-a', category:'voice-ack', src:'audio/ack-a.wav', trimStart:0.2, trimEnd:1.4 },
  { id:'ack-b', category:'voice-ack', src:'/audio/ack-b.wav' },
  { id:'laugh-a', category:'voice-laugh', src:'audio/laugh.wav' },
  ...['cluck','bark','chirp','low','quack','river','leaves'].map(category => ({id:category,category,src:'audio/'+category+'.wav'}))
];
function fixture(options = {}) {
  const ctx = new Context(); let fetches = 0;
  const engine = createSampleAudio({ catalogue:{version:1,clips}, baseUrl:'https://example.test/garden/', random:()=>0,
    fetch:async url => { const id=++fetches; assert.ok(url.startsWith('https://example.test/garden/audio/')); return {ok:true,arrayBuffer:async()=>new Uint8Array([id]).buffer}; }, ...options });
  engine.attach(ctx, ctx.destination);
  return {ctx,engine,get fetches(){return fetches;}};
}
await check('local URLs preserve nested deployment base and reject remote/traversal', () => {
  assert.equal(resolveSampleUrl('/audio/a.wav','https://x.test/sub/'),'https://x.test/sub/audio/a.wav');
  assert.equal(resolveSampleUrl('public/audio/a.wav','https://x.test/sub/'),'https://x.test/sub/audio/a.wav');
  for(const src of ['https://evil.test/a','//evil.test/a','../a','audio/../a','audio/%2e%2e/a','data:a','audio/a?x','audio/a#x']) assert.equal(resolveSampleUrl(src,'https://x.test/sub/'),null,src);
});
await check('safe stats before context, empty catalogue and disabled samples', async () => {
  const empty = createSampleAudio(); assert.equal(empty.getStats().context,'none'); assert.equal(await empty.unlock(),false); assert.equal(empty.play('voice-ack'),false);
  const f=fixture({config:{enabled:false}}); assert.equal(await f.engine.unlock(),true); assert.equal(f.ctx.resumes,1); assert.equal(f.fetches,0); assert.equal(f.engine.play('bark'),false);
});
await check('gesture resume synchronous, one inflight unlock, fetch/decode once cached', async () => {
  const f=fixture(); assert.equal(f.engine.play('voice-ack'),false); assert.equal(f.fetches,0);
  const a=f.engine.unlock(), b=f.engine.unlock(); assert.equal(a,b); assert.equal(f.ctx.resumes,1); await a;
  assert.equal(f.fetches,clips.length); assert.equal(f.ctx.decodes,clips.length); await f.engine.unlock(); assert.equal(f.fetches,clips.length); assert.equal(f.ctx.resumes,1);
  assert.equal(f.engine.getStats().load.ready,clips.length); f.engine.dispose();
});
await check('trim scheduling, release envelope, unchanged pitch and onended node cleanup', async () => {
  const f=fixture(); await f.engine.unlock(); assert.equal(f.engine.play('voice-ack',{x:10,z:0,emitterId:'a'}),true);
  const s=f.ctx.sources().at(-1), owned=f.ctx.nodes.slice(); assert.deepEqual(s.startArgs,[0.012,0.2,1.2]); assert.equal(s.playbackRate.value,1);
  const envelope=owned.find(n=>n.kind==='gain'); assert.ok(envelope.gain.events.some(e=>e[0]==='linear'&&e[1]===0&&e[2]>1));
  s.end(); assert.equal(f.engine.getStats().active,0); assert.ok(owned.every(n=>n.disconnected)); assert.equal(s.buffer,null); f.engine.dispose();
});
await check('same-category clip alternation and per-emitter cooldown', async () => {
  const f=fixture(); await f.engine.unlock(); f.engine.play('voice-ack',{emitterId:'p'}); const a=f.ctx.sources().at(-1); const id=a.buffer.id; a.end();
  assert.equal(f.engine.play('voice-ack',{emitterId:'p'}),false); f.ctx.currentTime=2; assert.equal(f.engine.play('voice-ack',{emitterId:'p'}),true); assert.notEqual(f.ctx.sources().at(-1).buffer.id,id); f.engine.dispose();
});
await check('single clip never repeats immediately, permits repeat after quiet window', async () => {
  const f=fixture(); await f.engine.unlock(); assert.equal(f.engine.play('bark',{emitterId:'a'}),true); f.ctx.sources().at(-1).end(); f.ctx.currentTime=3;
  assert.equal(f.engine.play('bark',{emitterId:'b'}),false); f.ctx.currentTime=13; assert.equal(f.engine.play('bark',{emitterId:'b'}),true); f.engine.dispose();
});
await check('explicit acknowledgement preempts ambient on same emitter, suppresses new ambient', async () => {
  const f=fixture(); await f.engine.unlock(); f.engine.play('voice-laugh',{ambient:true,emitterId:'p'}); const ambient=f.ctx.sources().at(-1);
  assert.equal(f.engine.play('voice-ack',{emitterId:'p'}),true); assert.ok(ambient.stopped&&ambient.disconnected); assert.equal(f.engine.getStats().active,1);
  assert.equal(f.engine.play('voice-laugh',{ambient:true,emitterId:'q'}),false); assert.equal(f.engine.play('chirp',{ambient:true}),false); f.engine.dispose();
});
await check('hard total and voice concurrency caps', async () => {
  const f=fixture({config:{maxConcurrent:3,maxVoices:1}}); await f.engine.unlock();
  assert.equal(f.engine.play('voice-ack',{emitterId:'a'}),true); assert.equal(f.engine.play('voice-ack',{emitterId:'b'}),false);
  assert.equal(f.engine.play('bark'),true); assert.equal(f.engine.play('cluck'),true); assert.equal(f.engine.play('quack'),false); assert.equal(f.engine.getStats().active,3); f.engine.dispose();
});
await check('ambient voice cap, mute and dispose release all owned nodes', async () => {
  const f=fixture(); await f.engine.unlock(); assert.equal(f.engine.play('voice-ack',{ambient:true,emitterId:'a'}),true); assert.equal(f.engine.play('voice-laugh',{ambient:true,emitterId:'b'}),false);
  f.engine.setMuted(true); assert.equal(f.engine.getStats().active,0); assert.equal(f.engine.play('bark'),false); assert.ok(f.ctx.nodes.every(n=>n.disconnected));
  f.engine.setMuted(false); assert.equal(f.engine.play('bark'),true); f.engine.dispose(); assert.equal(f.engine.getStats().active,0); assert.equal(f.engine.getStats().decodedBytes,0); assert.equal(await f.engine.unlock(),false);
});
await check('distance gain, source side, listener yaw and lowpass update while playing', async () => {
  const f=fixture(); await f.engine.unlock(); f.engine.play('bark',{x:20,z:0});
  const pan=f.ctx.nodes.find(n=>n.kind==='pan'), filter=f.ctx.nodes.find(n=>n.kind==='filter'), gain=f.ctx.nodes.filter(n=>n.kind==='gain')[1];
  const farGain=gain.gain.value, farCutoff=filter.frequency.value; assert.ok(pan.pan.value>0);
  f.engine.setListener({x:19,z:0,yaw:Math.PI}); assert.ok(pan.pan.value<0); assert.ok(gain.gain.value>farGain); assert.ok(filter.frequency.value>farCutoff);
  f.engine.setListener({x:21,z:0,yaw:0}); assert.ok(pan.pan.value<0); f.engine.dispose();
});
await check('fetch/decode/resume failures are quiet, handled and never retried per clip', async () => {
  for (const mode of ['fetch','decode','http']) {
    let calls=0; const f=fixture({fetch:async()=>{calls++; if(mode==='fetch')throw Error('offline'); return {ok:mode!=='http',arrayBuffer:async()=>new ArrayBuffer(1)};}});
    if(mode==='decode')f.ctx.decodeAudioData=async()=>{throw Error('bad codec');};
    await f.engine.unlock(); assert.equal(f.engine.getStats().load.failed,clips.length); assert.equal(f.engine.play('voice-ack'),false); await f.engine.unlock(); assert.equal(calls,clips.length); f.engine.dispose();
  }
  const f=fixture(); f.ctx.resume=()=>Promise.reject(Error('gesture rejected')); assert.equal(await f.engine.unlock(),false); assert.equal(f.fetches,0); f.ctx.resume=Context.prototype.resume; assert.equal(await f.engine.unlock(),true); f.engine.dispose();
});
await check('decoded/encoded budgets, invalid trim, and missing category stay silent', async () => {
  for(const config of [{maxEncodedBytes:1},{maxDecodedBytes:1}]) {
    const f=fixture({config,fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)})}); await f.engine.unlock(); const stats=f.engine.getStats(); assert.ok(stats.encodedBytes<=stats.budgets.maxEncodedBytes); assert.ok(stats.decodedBytes<=stats.budgets.maxDecodedBytes); assert.equal(f.engine.play('voice-ack'),false); f.engine.dispose();
  }
  const f=fixture({catalogue:{version:1,clips:[{...clips[0],trimStart:5,trimEnd:6}]}}); await f.engine.unlock(); assert.equal(f.engine.getStats().load.failed,1); assert.equal(f.engine.play('quack'),false); f.engine.dispose();
});
await check('no stereo panner fallback, closed context and scheduling failure are safe', async () => {
  const f=fixture(); f.ctx.createStereoPanner=null; await f.engine.unlock(); assert.equal(f.engine.play('bark'),true); f.engine.setMuted(true); f.engine.setMuted(false);
  f.ctx.createBufferSource=()=>{const n=f.ctx.node('source');n.start=()=>{throw Error('start failed');};return n;};
  assert.equal(f.engine.play('cluck'),false); assert.equal(f.engine.getStats().active,0); f.ctx.state='closed'; assert.equal(f.engine.play('voice-ack'),false); assert.equal(await f.engine.unlock(),false); f.engine.dispose();
});
await check('createSound preserves API, uses samples instead of oscillators, safe pre-unlock stats', async () => {
  const original=await readFile(new URL('../src/systems/sound.js',import.meta.url),'utf8');
  assert.ok(!original.includes('speakSyllable')&&!original.includes('const VOWELS'));
  const moduleSource=original.replace("import world from '../data/world.json';",'const world={sound:{},terrain:{}};').replace("import catalogue from '../data/audio-samples.json';",'const catalogue={version:1,clips:[]};').replace("'./sample-audio.js'",JSON.stringify(new URL('../src/systems/sample-audio.js',import.meta.url).href));
  const {createSound}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
  const oldWindow=globalThis.window; globalThis.window={AudioContext:Context};
  try {
    const sound=createSound({audioCatalogue:{version:1,clips},audioFetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})});
    assert.equal(sound.getStats().samples.context,'none');
    for(const name of ['unlock','update','voice','cluck','bark','chirp','low','quack','wood','bell','setAmbience','getLevels','getStats','debugRecord'])assert.equal(typeof sound[name],'function',name);
    assert.equal(sound.unlock(),true); for(let i=0;i<30;i++)await Promise.resolve(); const ctx=sound.context; assert.equal(sound.getStats().samples.load.ready,clips.length);
    assert.equal(sound.voice('elder',5,6),true); assert.equal(sound.cluck(3,2),true); assert.equal(sound.bark(5,3),true); assert.equal(sound.chirp(3,5),true); assert.equal(sound.low(4,6),true); assert.equal(sound.quack(4,7),true);
    assert.equal(ctx.nodes.filter(n=>n.kind==='oscillator').length,0); assert.equal(sound.getStats().counts.voices,1); assert.equal(sound.getStats().samples.active,6);
    const nodeCount=ctx.nodes.length, countsBeforePause={...sound.getStats().counts};
    sound.update(0,0,null,{x:0,y:0,z:0},true);
    assert.equal(sound.getStats().samples.active,0,'frozen dt0 stops existing samples'); assert.equal(sound.getStats().samples.muted,true);
    assert.equal(sound.voice('elder',7,8),false,'paused explicit calls are silent');
    for(let frame=0;frame<500;frame++){ctx.currentTime+=0.05;sound.update(frame%2?0:0.05,frame*0.05,null,{x:0,y:0,z:0},true);}
    assert.equal(ctx.nodes.length,nodeCount,'frozen update schedules no sampled OR procedural event nodes'); assert.deepEqual(sound.getStats().counts,countsBeforePause,'event clocks frozen');
    for(let frame=0;frame<500;frame++)sound.update(0,0,null,{x:0,y:0,z:0},false);
    assert.equal(ctx.nodes.length,nodeCount,'finite dt0 does not advance ambient clocks'); assert.equal(sound.getStats().samples.muted,false,'normal dt0 unfreezes sample gate');
    sound.update(0.05,26,null,{x:0,y:0,z:0},false); assert.equal(sound.voice('elder',7,8),true,'normal update resumes recorded interaction'); sound.disposeSamples();
  } finally {globalThis.window=oldWindow;}
});

await check('social chatter only actual speakers, sparse laughter not explicit acknowledgement', async()=>{
  const original=await readFile(new URL('../src/systems/sound.js',import.meta.url),'utf8');
  const moduleSource=original.replace("import world from '../data/world.json';",'const world={sound:{},terrain:{}};').replace("import catalogue from '../data/audio-samples.json';",'const catalogue={version:1,clips:[]};').replace("'./sample-audio.js'",JSON.stringify(new URL('../src/systems/sample-audio.js',import.meta.url).href));
  const {createSound}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
  const oldWindow=globalThis.window, oldRandom=Math.random, oldTimeout=globalThis.setTimeout;
  globalThis.window={AudioContext:Context}; Math.random=()=>0.1; globalThis.setTimeout=(...args)=>{const timer=oldTimeout(...args);timer.unref?.();return timer;};
  try {
    for(const [speaking,activity,expected] of [[false,'talk',0],[true,'listen',0],[true,'talk',1],[undefined,undefined,1]]){
      const person={role:'elder',x:2,z:3,mode:'talk',greetT:0,speaking,activity};
      const sound=createSound({village:{houseInfo:[{x:0,z:0}]},people:{list:[person]},audioCatalogue:{version:1,clips},audioFetch:async url=>({ok:true,arrayBuffer:async()=>new Uint8Array([url.includes('laugh')?66:url.includes('ack')?55:11]).buffer})});
      sound.unlock();for(let i=0;i<30;i++)await Promise.resolve();
      for(let frame=0;frame<135;frame++){sound.context.currentTime=frame*0.05;sound.update(0.05,frame*0.05,null,{x:0,y:0,z:0},false);}
      assert.equal(sound.getStats().counts.voices,expected,'speaking='+speaking+', activity='+activity);
      if(expected){assert.ok(sound.context.sources().some(n=>n.playedBuffer?.id===66),'social laughter category used');sound.context.currentTime=10;assert.equal(sound.voice('elder',2,3),true);assert.equal(sound.context.sources().at(-1).playedBuffer.id,55,'explicit never random laughter');}
      sound.disposeSamples();
    }
  }finally{globalThis.window=oldWindow;Math.random=oldRandom;globalThis.setTimeout=oldTimeout;}
});
await check('exact original sound baseline is preserved',async()=>{
  const baseline=await readFile(new URL('../.visual-round3-baseline/src/systems/sound.js',import.meta.url));
  assert.equal(createHash('sha256').update(baseline).digest('hex'),'3f2ebbb733264733c091023ecfe7e3988fc9f5c2058544bdc7b9ec7aca9a962c');
});
await check('load worker concurrency limit and disposal during decode', async () => {
  const held=[]; let inflight=0, peak=0;
  const f=fixture({config:{loadConcurrency:2},fetch:()=>new Promise(resolve=>{inflight++;peak=Math.max(peak,inflight);held.push(()=>{inflight--;resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});});})});
  const pending=f.engine.unlock(); for(let i=0;i<5;i++)await Promise.resolve(); assert.equal(held.length,2);
  for(let batch=0;batch<clips.length;batch++){ const release=held.splice(0); for(const done of release)done(); for(let i=0;i<8;i++)await Promise.resolve(); }
  await pending; assert.equal(peak,2); assert.equal(f.engine.getStats().load.ready,clips.length); f.engine.dispose();
  let releaseDecode; const g=fixture({catalogue:{version:1,clips:[clips[0]]}});
  g.ctx.decodeAudioData=()=>new Promise(resolve=>{releaseDecode=resolve;}); const opening=g.engine.unlock(); for(let i=0;i<8;i++)await Promise.resolve(); assert.equal(typeof releaseDecode,'function');
  g.engine.dispose(); releaseDecode({duration:1,length:1000,numberOfChannels:1}); assert.equal(await opening,false); assert.equal(g.engine.getStats().decodedBytes,0); assert.equal(g.engine.getStats().load.disposed,1);
});
await check('aborted timeout fetch is handled and disposed fetch cannot allocate nodes', async()=>{
  let aborted=false;
  const f=fixture({config:{loadTimeoutMs:1},catalogue:{version:1,clips:[clips[0]]},fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}))});
  await f.engine.unlock(); assert.equal(aborted,true); assert.equal(f.engine.getStats().load.failed,1); assert.equal(f.engine.play('voice-ack'),false); f.engine.dispose();
});

await check('roosterCrow plays decoded real crow recordings and alternates for dawn valley echo', async () => {
  const original = await readFile(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
  const moduleSource = original.replace("import world from '../data/world.json';", 'const world={sound:{animals:{crow:0.58}},terrain:{}};').replace("import catalogue from '../data/audio-samples.json';", 'const catalogue={version:1,clips:[]};').replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
  const crowClips = [
    { id: 'crow-01', category: 'crow', src: '/audio/round3/crow-01.mp3' },
    { id: 'crow-02', category: 'crow', src: '/audio/round3/crow-02.mp3' }
  ];
  const oldWindow = globalThis.window, oldTimeout = globalThis.setTimeout;
  globalThis.window = { AudioContext: Context };
  globalThis.setTimeout = (...args) => { const timer = oldTimeout(...args); timer.unref?.(); return timer; };
  try {
    const sound = createSound({
      audioCatalogue: { version: 1, clips: crowClips },
      audioFetch: async url => ({ ok: true, arrayBuffer: async () => new Uint8Array([url.includes('crow-01') ? 71 : 72]).buffer })
    });
    assert.equal(sound.unlock(), true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const ctx = sound.context;
    const before = ctx.sources().length;
    assert.equal(sound.roosterCrow(28, -118), true);
    assert.equal(sound.roosterCrow(0, -98, { echo: true }), true);
    const played = ctx.sources().slice(before);
    assert.equal(played.length, 2);
    assert.equal(played[0].playedBuffer?.id === 71 || played[0].playedBuffer?.id === 72, true, 'uses decoded real rooster recording');
    assert.notEqual(played[0].playedBuffer?.id, played[1].playedBuffer?.id, 'dawn echo alternates to distinct rooster recording');
    assert.equal(played[0].playbackRate.value, 1, 'preserves natural recorded pitch');
    sound.update(0, 0, null, { x: 0, y: 0, z: 0 }, true);
    assert.ok(played.every(s => s.stopped), 'pause stops active rooster crow');
    sound.disposeSamples();
  } finally {
    globalThis.window = oldWindow;
    globalThis.setTimeout = oldTimeout;
  }
});

await check('frog, stagCall and roosterFlap play real recordings / pre-crow wing-flap and stop on pause', async () => {
  const original = await readFile(new URL('../src/systems/sound.js', import.meta.url), 'utf8');
  const moduleSource = original
    .replace("import world from '../data/world.json';", 'const world={sound:{},terrain:{pond:{x:10,z:-80,radius:8}}};')
    .replace("import catalogue from '../data/audio-samples.json';", 'const catalogue={version:1,clips:[]};')
    .replace("'./sample-audio.js'", JSON.stringify(new URL('../src/systems/sample-audio.js', import.meta.url).href));
  const { createSound } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
  const extraClips = [
    { id: 'frog-01', category: 'frog', src: '/audio/round3/frog-01.mp3' },
    { id: 'frog-02', category: 'frog', src: '/audio/round3/frog-02.mp3' },
    { id: 'stag-01', category: 'stag', src: '/audio/round3/stag-01.mp3' },
    { id: 'stag-02', category: 'stag', src: '/audio/round3/stag-02.mp3' }
  ];
  const oldWindow = globalThis.window, oldTimeout = globalThis.setTimeout;
  globalThis.window = { AudioContext: Context };
  globalThis.setTimeout = (...args) => { const timer = oldTimeout(...args); timer.unref?.(); return timer; };
  try {
    const idMap = { 'frog-01': 81, 'frog-02': 82, 'stag-01': 91, 'stag-02': 92 };
    const sound = createSound({
      audioCatalogue: { version: 1, clips: extraClips },
      audioFetch: async url => {
        const hit = Object.entries(idMap).find(([k]) => url.includes(k));
        return { ok: true, arrayBuffer: async () => new Uint8Array([hit ? hit[1] : 99]).buffer };
      }
    });
    assert.equal(sound.unlock(), true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    sound.update(0.05, 0.5, null, { x: 10, y: 1, z: -80, yaw: 0 }, false);
    const ctx = sound.context;

    const beforeFrog = ctx.sources().length;
    assert.equal(sound.frog(12, -82), true);
    assert.equal(sound.frog(14, -79), true);
    const frogPlayed = ctx.sources().slice(beforeFrog);
    assert.equal(frogPlayed.length, 2);
    assert.ok([81, 82].includes(frogPlayed[0].playedBuffer?.id), 'frog plays decoded real night-pond recording');
    assert.notEqual(frogPlayed[0].playedBuffer?.id, frogPlayed[1].playedBuffer?.id, 'frog alternates between clips');
    assert.equal(frogPlayed[0].playbackRate.value, 1);
    assert.equal(sound.getStats().counts.frogs, 2);

    const beforeStag = ctx.sources().length;
    assert.equal(sound.stagCall(18, -86), true);
    assert.equal(sound.stagCall(18, -86), true);
    const stagPlayed = ctx.sources().slice(beforeStag);
    assert.equal(stagPlayed.length, 2);
    assert.ok([91, 92].includes(stagPlayed[0].playedBuffer?.id), 'stagCall plays decoded real forest sika deer whistle');
    assert.notEqual(stagPlayed[0].playedBuffer?.id, stagPlayed[1].playedBuffer?.id, 'stagCall alternates between clips');
    assert.equal(stagPlayed[0].playbackRate.value, 1);
    assert.equal(sound.getStats().completionSync.stagCalls, 2);

    assert.equal(sound.roosterFlap(12, -80), true, 'roosterFlap plays pre-crow wing-flap');
    sound.syncWorld(0.05, { rain: 0, isNight: false, events: [{ type: 'roosterFlap', x: 12, z: -80 }] });
    assert.equal(sound.getStats().completionSync.roosterFlaps, 2, 'syncWorld dispatches roosterFlap');

    sound.update(0, 0, null, { x: 10, y: 1, z: -80 }, true);
    assert.ok(frogPlayed.every(s => s.stopped) && stagPlayed.every(s => s.stopped), 'pause stops active frog and stag recordings');
    sound.disposeSamples();
  } finally {
    globalThis.window = oldWindow;
    globalThis.setTimeout = oldTimeout;
  }
});

// Optional final asset gate, run only once asset worker has supplied catalogue and license files.
if(process.argv.includes('--assets')) await check('catalogue local file hashes, byte sizes, categories and license provenance', async()=>{
  const root=new URL('../',import.meta.url);
  const catalogue=JSON.parse(await readFile(new URL('src/data/audio-samples.json',root),'utf8')); assert.equal(catalogue.version,1);
  // River/leaves are optional approved enhancements; procedural ambience is preserved.
  const expected=['voice-ack','voice-laugh','cluck','crow','frog','stag','bark','chirp','low','quack'];
  for(const category of expected)assert.ok(catalogue.clips.some(c=>c.category===category),category);
  for(const category of ['voice-ack','voice-laugh','crow','frog','stag'])assert.ok(catalogue.clips.filter(c=>c.category===category).length>=2,category+' alternatives');
  const ids=new Set(); let total=0;
  for(const clip of catalogue.clips){
    assert.ok(!ids.has(clip.id)); ids.add(clip.id); assert.ok([...expected,'river','leaves'].includes(clip.category)); assert.ok(resolveSampleUrl(clip.src,'https://local.test/sub/'));
    for(const field of ['sourceUrl','license','licenseUrl','attribution','sha256'])assert.equal(typeof clip[field],'string',clip.id+':'+field);
    assert.match(clip.sourceUrl,/^https?:\/\//); assert.match(clip.licenseUrl,/^https?:\/\//); assert.ok(clip.license.length>0&&clip.attribution.length>0);
    const data=await readFile(new URL('public/'+clip.src.replace(/^public\//,'').replace(/^\//,''),root));
    assert.equal(data.length,clip.bytes); assert.equal(createHash('sha256').update(data).digest('hex'),clip.sha256); total+=data.length;
    assert.ok(['CC0-1.0','CC-BY-4.0'].includes(clip.license),'approved redistribution license');
    const license=await readFile(new URL('public/audio/round3/licenses/'+clip.license+'.txt',root),'utf8'); assert.ok(license.length>100);
    const notice=await readFile(new URL('public/audio/round3/NOTICE.md',root),'utf8'); assert.ok(notice.includes(clip.sourceUrl),clip.id+' source in shipped notice');
  }
  assert.ok(total<=12*1024*1024,'asset delivery target <=12MiB');
});
console.log(JSON.stringify({passed:tests,evidence:'fake WebAudio scheduling/lifecycle only',realPlayback:'not performed',humanListening:'not performed'}));
