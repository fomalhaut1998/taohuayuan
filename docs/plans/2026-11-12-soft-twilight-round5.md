# Soft Twilight and Original Night Implementation Plan

**Goal:** Restore the pre-round4 night style and add restrained golden-pink dusk, peach dawn haze and directional water glints, preserving accepted clear day and gameplay.

**Architecture:** Extend createSky with a stable, smoothed twilight state; gate dawn/dusk-only sky layers and weather attenuation. Match night material colors to .visual-round4-baseline/src/systems/sky.js, retaining registration/disposal/private shader audit improvements. Add one composable fragment-only river material hook, with zero day/night amount and no geometry/new render target/draws. Keep world.json unchanged.

**Tech Stack:** Existing Three.js r170/Vite6, GLSL, procedural sky and existing transparent river; no new dependencies/assets/server. Ordinary independent subagents, not AgentTeams; no Git repository/worktree/commit available.

## Task 1 — Sky and legacy night
Files: src/systems/sky.js, src/systems/scene-appearance.js, optional new src/systems/twilight.js, new scripts/check-soft-twilight.mjs; targeted scripts/check-time-appearance.mjs expectation amendment (save original intact).
1. Add tests proving old-night albedo/unlit/mountain equivalence for all weather, accepted day identity, distinct smoothed dawn/dusk states and rain suppression.
2. Record failing test against current code.
3. Restore original saturated night (remove round4 desaturation), keep material registration and static audit. Add a readable low golden solar disc, pastel direction-aware elongated lit clouds and restrained dawn haze; no full-screen filter or flat orange sky.
4. Expose getTwilightState() returning a stable object {amount,dawn,dusk,direction:Vector3,color:Color,clock}; direction is actual normalized light direction, color linear, amount zero for settled day/night, cloud/weather-gated. Preserve moon/star baseline.
5. Run node scripts/check-soft-twilight.mjs, node scripts/check-time-appearance.mjs, node scripts/test-sky-clouds.mjs, node scripts/check-clear-day.mjs. Amend only assertions that intentionally demanded removed desaturation, not safety/restoration checks.

## Task 2 — Water glints
Files: new src/systems/twilight-water.js and scripts/check-twilight-water.mjs only.
1. Add failing tests for createTwilightWater(mesh,sky) -> {update(dt),dispose(),getStats()}.
2. Compose existing material hook/cache key safely; twilight state is live and updates without allocation/compilation. Add bounded directional rippled light to water outgoingLight only; no added mesh/geometry/texture/render target, no mutation of stream wave/surfaceY/UV/depth/opacity.
3. Day/night amount zero; rain/mist diminish; light is view/direction-dependent and avoids a uniformly painted gold river. dt=0 freezes ripple clock; dispose idempotently restores own hook without overwriting later owner.
4. node scripts/check-twilight-water.mjs; preserve .visual-round5-baseline/src/world/stream.js byte identity.

## Task 3 — Captain integration and proof
Files: src/main.js minimal import/create/update; new scripts/check-round5-integration.mjs; preview/verify-round5.sh and independent report.
1. Create glint adapter after sky registers existing materials, update only in normal world loop after sky, never paused branch. No story/observation/save/map clock changes.
2. Assert main wiring, unchanged world.json/day/night configuration/stream/colliders, fragment-only eligibility exclusion and no extra draws.
3. Run every scripts/check-*.mjs and scripts/test-*.mjs plus node scripts/check-sampled-audio.mjs --assets; npm run build.
4. Read-only independent review latest sources; fix genuine findings and rerun affected gates.
5. Use authorized browser on existing http://127.0.0.1:4173 only. Actual same-pose dawn/dusk/day/night GPU pixels, sun-facing river view, original-night comparison and real shader link/error/render statistics. Do not spoof document.hidden or claim FPS if hidden. Preserve historical reports; present concise real images with explicit limits.
