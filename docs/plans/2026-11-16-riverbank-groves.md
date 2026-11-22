# Riverbank Naturalization and Peach-Grove Spacing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the existing low-poly riverbank and peach woods readable shallows, clustered shore details, woodland gaps and isolated trees without adding vegetation, draw batches, particles or real-time reflections.

**Architecture:** Opt in to bounded, deterministic bank relief only along the exterior stream, fading out before the cave and leaving the dry walking shoulder, village, pond and river spine unchanged. Reuse the existing terrain grid and existing reed/stone/tree instance budgets; construction-time layout logic does not enter the animation loop. Keep collision sampling tied to the displaced terrain grid.

**Tech Stack:** Vite, vanilla Three.js ES modules, deterministic Node regression checks. No new dependencies.

---

### Task 1: Riverbank profile and layout
**Files:** Create src/world/riverbank.js and scripts/check-riverbank-naturalization.mjs. Modify src/world/terrain.js, src/world/reeds.js, src/world/scatter.js, src/main.js and src/data/world.json.
1. Add failing checks for deterministic shoal/cut-bank variation, unchanged dry shoulder/portal/village heights, continuous water coverage and unchanged mesh/instance budgets.
2. Add a smooth, bounded relief mask in the exterior stream toe only; share it with visual wet-earth/shingle coloring.
3. Redistribute existing reeds into separated patches and a bounded portion of the 190 existing stones into flattened shingle clusters; retain legacy optional-argument behavior and road/building rejection.
4. Run the new check plus existing landscape/exploration checks; inspect same-view renders when browser operations are available.

### Task 2: Peach-grove spacing
**Files:** Modify src/world/flora.js; create a focused scripts/check-peach-grove-spacing.mjs (child owns these only).
1. Preserve near/far batching, maximum tree count, tree geometry and public spot/API contracts.
2. Use deterministic stand-scale variation and gaps instead of uniform bank-band rejection; keep spawn and slope/bounds protection.
3. Give individual stands coordinated but non-identical height/lean/tint, with restrained solitary trees in the gaps, without forcing more high-detail instances.
4. Check determinism, measurable sparse/dense contrast, protected clearances and non-increasing allocated geometry/instance counts.

### Task 3: Verification and delivery
**Files:** Append results to this plan; optional evidence under docs/plans/.
1. Capture fixed riverbank and peach-wood views before/after and actual renderer.info calls/triangles if browser page operations work. Do not equate Node geometry totals with viewport rendering or FPS.
2. Run npm test and npm run build; investigate every nonzero exit.
3. Report exact changes, tested facts and any foreground FPS/browser gaps. Stop and collect all owned servers and stop browser sessions.
4. Do not commit or create a worktree: the existing checkout is wholly untracked and the user requested direct refinement, not a Git migration.

## Riverbank verification (implementation checkpoint)

- The failing-first riverbank check now passes: 498 displaced vertices on the original 73,728-triangle terrain; maximum displacement 0.893704 m. The dry shoulder, channel spine, cave, pond and village retain their exact heights.
- Of 134 sampled outer water edges, all remain covered by solid bank above the maximum water wave; 124 sampled heightfield waterline crossings moved by at least 0.25 m.
- Reed and stone budgets remain 1,200 and 190 in their existing batches; 72 existing stones are reassigned to the exterior bank. Along-stream reed-bin coefficient of variation is 0.700345 versus 0.224745 with patch sampling disabled. This measures layout contrast, not visual quality or FPS.
- Repeated seeds reproduce reed and shingle matrices exactly. An unsuitable custom shoal field falls back to ordinary stones without dropping the old stone count.
- Shared patch anchors are configured under `terrain.shoreline.patches` in world data. Optional legacy calls and the reed patch-disable override remain supported.
- Existing ink-geometry and exterior-route historical snapshots are retained on explicit legacy fixtures (shoreline disabled; grove layout disabled where relevant), rather than changing their expected hashes. Active-world topology, full-width dry paths, slopes, collision, crown clearance, line of sight and rendered-ground clearance remain separately asserted.
- Browser verification is in progress. No reliable pre-change browser baseline exists; Node counts above are not viewport render submissions or foreground performance measurements.

## Grove verification (implementation checkpoint)

- `scripts/check-peach-grove-spacing.mjs` now passes: 656 of 1,950 far spots moved (>=120 required), 111 near trees and all near matrices/colours stay byte-identical, and the total allocated triangle budget is unchanged at 266,668.
- 12 m walking-scale windows along the two dry banks show sparse/dense contrast 3.93 (threshold 3), at least one gap with 1 tree where legacy had >=3, and 5 isolated changed trees with >=7 m clearance. The peach used by the "桃阴小憩" stop is still the same actual tree.
- Layout only touches spots with legacy z >= 64 and new z >= 64; bounds, river band, spawn clearance, slope limit and near-geometry rejection are asserted for every final spot. `y = field.sample(x, z)` is re-sampled after each move.
- Determinism is checked by constructing twice and comparing spots/instanceMatrix/instanceColor exactly. Configuration is not mutated. Authored geometry and vertex colours are unchanged; only far instance transforms move.
- Layout is deterministic hash-based and does not consume the mulberry32 stream, so `groveLayout: false` reproduces the legacy planting exactly for historical fixtures. Existing per-tree height/lean/scale and tint variation is retained, but no new per-stand tint scheme was added.

## Browser evidence (viewport, not FPS)

- Page operations in a hidden `noFocus` tab correctly paused the main loop (`document.hidden === true`, 0 rendered frames), so foreground FPS could not be measured there.
- With a fixed bank camera at (26, 3.1, 204) looking at (0, 1, 144), day/clear, viewport 1435x681 DPR 1, one manual pass of the existing static-visibility, sky, water, wind and contact-shadow renderers produced `renderer.info.render`: 214 calls / 605,427 triangles, with 65 programs, 256 geometries and 4 textures. This is a real GPU submission for that view, not a normal racing loop, a 1080p run, or a guarantee of 55/60 FPS; 214 calls also exceeds the 200-call iGPU guidance.
- A screenshot from the hidden window contained only sky/HUD because the canvas was not preserveDrawingBuffer; it is not valid visual evidence and is not cited as sign-off.

## Operational constraints
Experience lookup was attempted but the OpenViking embedding endpoint returned AccountOverdueError (403). The Rule-search API is not registered in the available SDK, so that check is unavailable; the on-disk PROJECT_BRIEF and user authorization remain the concrete authority.

## Final verification

- Full `npm test && npm run build` completed with exit code 0. The runner auto-discovered 63 checks; the earlier 58/63 run is now fully green. The Vite production build succeeded; its existing >550 kB chunk warning is not introduced by this change.
- Accepted the riverbank keys in the frozen fixtures: `.visual-round3/4/5/6-baseline/src/data/world.json` now carry only the audited `terrain.shoreline` block and `stone.shoreCount: 72`; every other byte stays identical. `scripts/check-round3/4/5/6-integration.mjs` pass again, so those guards still catch unrelated world rewrites.
- Grove layout constants are defaults in `src/world/flora.js` (`startZ 64`, `endZ 380`, `period 46`, `gap 19`, `spread 13`, `minSeparation 2.2`, landmark `[16, 120]`), so `src/data/world.json` gains no new key. `groveLayout: false` still reproduces legacy planting and an object override remains supported. Round 7's historical reservation hash uses an explicit `legacyFlora` fixture while the active layout feeds the rest of that check.
- Final measured facts: 656/1,950 grove spots moved, 266,668 allocated triangles, sparse/dense contrast 3.93, 5 isolated trees; 498 displaced bank vertices, 0.894 m maximum relief, 1,200 reeds, 190 stones (72 shore). The viewport static pass measured 214 calls / 605,427 triangles at 1435x681 DPR 1; this is a real GPU submission, not a foreground FPS run, not 1080p, and the call count exceeds the 200-call iGPU guidance.
- Cleanup: no browser sessions, pending cleanup or background jobs remain. No commit or worktree was created; the checkout remains wholly untracked.

## Remaining gaps

- No foreground FPS, frame-time trace, or 1080p budget validation was obtained. The hidden page pauses the loop by design, and the manual static pass is not a running frame.
- No valid screenshot or visual sign-off exists: the hidden-window capture contained only sky/HUD. Visual acceptance still needs a foreground look at the fixed bank and grove views.
