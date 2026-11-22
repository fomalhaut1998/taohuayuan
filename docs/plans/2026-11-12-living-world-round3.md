# Living World Round 3 Implementation Plan

> Execution: subagent-driven in this session; use the available executing-plans workflow for any separate-session handoff. No Git/worktree exists here; do not initialize one or add dependencies.

**Goal:** Make the outside peach woods and river invite safe exploration, make villagers/animals react causally and recover naturally, and replace fake vocal sounds with licensed short recordings while preserving text dialogue.

**Architecture:** Keep existing generators and stable actors. Add a separate deterministic exterior reservation/layout and small static geometry, a low-rate bounded activity/attention layer driving existing animation, and a gesture-unlocked cached Web Audio sample bank. Main remains a narrow integration layer.

**Tech Stack:** Existing Vite, Three.js and native Web Audio only.

## Accepted design and hard constraints
- User selected nonverbal acknowledgement/laugh short sounds, not full dialogue dubbing. Text, story triggers, E interaction/journal and saved-state schemas remain unchanged.
- Retain clear blue day from round2 and low-poly style. Do not change terrain, existing tree RNG, cave reveal or old route positions.
- Preserve exact originals of changed files in .visual-round3-baseline, keep previous baselines and reports.
- Preserve actor identities/order/roles, public people/fauna method sets, five fauna instanced draws and existing articulation buffers.
- Exploration incremental cap: 4500 triangles / 3 static draws; choose dry reachable gaps with full footprint and route-width checks inside radius230. No water-walking, forced geometry placement or global basin safety relaxation.
- Behavior decisions staggered around 5Hz; animation stays frame-rate, dt pause/invalid-step semantics stay intact. E reactions override autonomous decisions; bounded hysteresis/rearm prevents repeated alarm.
- Audio: real local clips with verified permissive licenses, source/attribution/SHA256/bytes manifest; no external runtime fetch, no online TTS, no pretend recorded synthesis. Target <=12MiB assets. Bounded concurrency, emitter cooldowns and no immediate repetition; silence on unavailable vocals.

## Task 1 — Exterior exploration
**Files:** new src/world/exterior-exploration.js, optional exterior-geometry.js; scripts/check-exterior-exploration.mjs; narrowly optional reeds.js predicate.
1. Add actual-world failing layout tests for dry whole footprints, route edges, spawn/portal/boat/tree reservations and deterministic source immutability.
2. Implement separate outside planner and three small stopping places at ferry/net-bank, peach clearing and lower bend, plus readable worn routes, restrained rocks/logs/ferns. Reuse current boats/quiet rewards, not duplicated structures or quest pins.
3. Validate real emitted vertices, normals/materials, route collision and sightlines; keep incremental cost under cap. Return explicit layout/rejects/blockers/approach/view points.
4. Run node scripts/check-exterior-exploration.mjs and existing relevant route/mystery tests; send exact integration API/config and accepted stops.

## Task 2 — Living actors
**Files:** src/world/people.js, src/systems/fauna.js, optional src/systems/living-behavior.js, targeted people/fauna settings in src/data/world.json; scripts/check-living-behavior.mjs.
1. Write failing deterministic state/route/event tests: slow versus fast approach, occlusion, coincidence vector, E priority, recovery, cooldown, invalid dt, rain and night change.
2. Implement bounded staggered work/rest, play/look and social speaking/listening episodes; acknowledge at entry rather than distance-oscillating forever. Add safe nearby person/animal awareness without global chains.
3. Add backwards-compatible optional fauna navigation and update context; validate movement paths before selecting targets, skip unsafe movement. Preserve counts/geometry/API/index contracts.
4. Expose only actor scalar activity/speaking/attention/socialTurn fields; sound follows actual speaker. Run focused old/new character/fauna regressions.

## Task 3 — Recorded audio assets and playback
**Files:** public/audio/round3/**, src/data/audio-samples.json, docs/audio-round3-sources.md; src/systems/sample-audio.js, src/systems/sound.js; scripts/check-sampled-audio.mjs.
1. Acquire and license-verify human acknowledgement/chuckle and chicken/dog/bird/cattle/duck recordings. Record exact sources and notices. Optional stream/leaves only within budget.
2. Test manifest file hashes/licenses/format and fake-WebAudio unlock/cache/load failure/concurrency/mute/spatial trim/cleanup.
3. Implement lazy local decode/cache and replay-safe short voices through existing positional sound chain; preserve public methods. Remove fake human/animal fallback and suppress ambient chatter during explicit interactions.
4. Run focused tests; browser later validates real decode/playback graph, not perceived realism from metrics alone.

## Task 4 — Captain integration and review
**Files:** src/main.js, additive exploration/audio settings in src/data/world.json after behavior owner releases it; optional static-visibility allowlist only if audited.
1. Save originals, add factory before shared collision; add actual exterior blockers and accepted quiet/observation spots without changing old ids or E handling.
2. Supply optional fauna nav context and dt-driven time/weather/player-speed references; no per-frame allocations if reusable context suffices. Explicitly include only new audited static roots in visibility optimizer.
3. Independent read-only review contracts/source/latest evidence, repair any real defects.
4. Run all scripts/check-*.mjs and scripts/test-*.mjs, then npm run build. Existing tests must not be weakened; report chunk warnings.
5. Use existing authorized browser URL http://127.0.0.1:4173, not a new server: actual walks/approaches, day/rain, behavior traces and local audio network/decode/playback. Capture comparable screenshots and measured renderer counts/decision timings. Never fake document focus or claim unmeasured foreground FPS or auditory listening.
6. Preserve round2 report. Write separate round3 report with sources, actual changes, test outputs, images, budget and honest limitations; publish finished deliverables.
