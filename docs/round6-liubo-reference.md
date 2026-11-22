# Round 6: liubo visual reference and interpretation limits

Checked 2026-11-13. The pavilion is an artistic rural scene, not an archaeological reconstruction or a playable ancient-rules simulator.

## Credible object records

- [Metropolitan Museum of Art, Liubo Board and Pieces, object 50484](https://www.metmuseum.org/art/collection/search/50484), accession 1994.285a–m. [Official collection API](https://collectionapi.metmuseum.org/public/collection/v1/objects/50484) returned HTTP 200: China, Han dynasty, 1st century BCE–1st century CE; earthenware with pigment and bone; L 36.2 cm × W 31.4 cm × H 5.1 cm. [Public-domain object photograph](https://images.metmuseum.org/CRDImages/as/original/DP372026.jpg). The ordinary website returned a Vercel security checkpoint, so metadata was checked via the museum's own API instead.
- [Metropolitan Museum of Art, Pair of Seated Figures Playing Liubo, object 44732](https://www.metmuseum.org/art/collection/search/44732), accession 1992.165.23a, b. [Official collection API](https://collectionapi.metmuseum.org/public/collection/v1/objects/44732) returned HTTP 200: China, Han dynasty, 1st century BCE–1st century CE; earthenware with pigment. The catalogue search description mentions a board divided into roads, twelve pieces (six per player), and thrown dice determining moves.

## What the model does, and does not, claim

The modeled square board has a central square and fourfold arrangements of T-, L- and V-shaped road marks; contrasting rectangular counters are six per side and six slender casting sticks lie beside it. It is intentionally **not** a Go grid or a modern chessboard. The pattern is a recognizable visual interpretation, not a precise traced replica of museum object 50484. Counter moves and spectator gestures are illustrative social animation only. Exact ancient rules, scoring, legal routes and the relationship of every mark to play are **not claimed to have been reconstructed**.

The thatched hip roof differs from the older village tea scene's fabric canopy. The shrine is an uninscribed weathered stone with five colored ribbons and simple wooden plaques, not a claim about one specific historical deity or ritual.

## Spatial and interaction contract

The pavilion, its board and its two liubo stations form one dry pondside overlook at (51, -155.5), 17.36 m from the original pond center (68, -152). The supported timber footbridge is beside the same pond at (51, -161.5), 19.47 m from its center. The protected pond footprint (radius 13.7 m), original water geometry, shoreline and terrain remain untouched. The short timber footbridge follows the unchanged original collision terrain, with both landings dry. It is a low swale crossing, never an unsupported elevated bridge over deep water. The bamboo conduit is an open half-cylinder trough with shared continuous endpoints; its inlet is a small constructed hillside catchment and outlet is a stone basin immediately outside an actual house's chimney-side rear wall. It is a modest demonstrative spring supply, not a new river or hydrodynamic simulation.

Stations use world-space ground roots and Three.js +Y yaw; local +Z faces (sin(yaw), 0, cos(yaw)). Props remain owned by the grove. A prop's communityContact is a point LOCAL TO ITS STATION, not local to the prop. The consumer may manipulate a prop but must not dispose its resources.

## Focused real-world verification

`node scripts/check-leisure-grove.mjs` passes with the exact factory sequence habitat details → pond life → waterworks → leisure grove. All seven regions succeed; eight stations include two facing grass-game children and two opposing liubo participants (one movable counter owner). Final geometry: 14,860 triangles / 5 draw calls against 15,000 / 16 limits; opaque actual vertex-color buffers, 8 bamboo culms, 5 shoots, 2 fruit trees, 2 hollow bee logs, 8 bees and 5 ribbons. The test checks old source hashes, dry terrain-supported bridge treads, ground-sampled station roots, 0.1 m sampled actor paths against old and new solids, exact prop contact transforms, ≤1 m horizontal hand reach, strictly descending connected kitchen conduit, deterministic repeated placement, dt freeze/clamp and owned-only idempotent disposal. The production discoveryScore selector is also exercised for every one of the ten target IDs against the actual combined original and round-6 colliders plus original terrain, from dry player-height viewpoints outside the production padded movement OBBs. Shrine and tree endpoints are exposed-face points, with separate physically height-bounded plinth/upright boxes and no ownBlocker LOS exemption. Browser appearance, full-suite and build verification are deliberately left to the captain.

The conduit narrowly replaces only its receiving house's coarse padded house/porch disks with actual wall/front-porch OBBs; the original door approach and shelter corridors, all other houses, old props/trees/fields and prior round-6 reservations remain enforced. It checks the entire supply run at ≤0.1 m spacing and exposes successful reservations as finite disks/OBBs, including the entire conduit corridor.

