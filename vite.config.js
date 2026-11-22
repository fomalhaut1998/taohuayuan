export default ({ command }) => ({
  // GitHub Pages 走 /taohuayuan/ 子路径；Vercel 走根域名（其构建环境自带 VERCEL=1）；开发保持根路径
  base: process.env.VERCEL ? '/' : command === 'build' ? '/taohuayuan/' : '/',
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('/node_modules/three/')) return 'three';
          if (normalized.includes('/src/data/')) return 'world-data';
          if (
            normalized.endsWith('/src/character-parts.js') ||
            normalized.endsWith('/src/player/collision.js') ||
            normalized.endsWith('/src/systems/community-actors.js') ||
            normalized.endsWith('/src/systems/living-behavior.js') ||
            normalized.endsWith('/src/systems/scene-appearance.js') ||
            normalized.endsWith('/src/systems/shader-cache-key.js') ||
            normalized.endsWith('/src/systems/observation.js') ||
            normalized.endsWith('/src/systems/mysteries.js') ||
            normalized.endsWith('/src/world/habitat-details.js') ||
            normalized.endsWith('/src/world/hinterland.js') ||
            normalized.endsWith('/src/world/exterior-exploration.js') ||
            normalized.endsWith('/src/world/model-geometry.js') ||
            normalized.endsWith('/src/world/terrain.js') ||
            normalized.endsWith('/src/world/ink-landscape.js') ||
            normalized.endsWith('/src/world/riverbank.js') ||
            normalized.endsWith('/src/world/mysteries.js') ||
            normalized.endsWith('/src/world/lod-geometries.js') ||
            normalized.endsWith('/src/world/qin-han-fauna-geometry.js')
          ) return 'shared-core';
          if (normalized.endsWith('/src/systems/mapdraw.js')) return 'mapdraw';
          if (normalized.endsWith('/src/systems/scroll-studio.js') || normalized.endsWith('/src/systems/scroll-colophons.js')) return 'scroll-studio';
          if (normalized.endsWith('/src/player/touch-controls.js')) return 'touch-controls';
          if (normalized.endsWith('/src/systems/sound.js') || normalized.endsWith('/src/systems/sample-audio.js')) return 'audio-engine';
          if (
            normalized.endsWith('/src/world/outer-wilds.js') ||
            normalized.endsWith('/src/world/deep-hollows.js') ||
            normalized.endsWith('/src/world/wilds-easter-eggs.js') ||
            normalized.endsWith('/src/world/valley-borderlands.js') ||
            normalized.endsWith('/src/world/valley-borderlands-geometry.js') ||
            normalized.endsWith('/src/world/wuling-outskirts.js') ||
            normalized.endsWith('/src/world/qianmo-paths.js') ||
            normalized.endsWith('/src/world/easter-eggs.js') ||
            normalized.endsWith('/src/world/act3-finale.js')
          ) return 'wilds-expansion';
          if (
            normalized.includes('/src/world/qin-han-') ||
            normalized.includes('/src/world/village') ||
            normalized.endsWith('/src/world/ox-plowing.js') ||
            normalized.endsWith('/src/world/hospitality-feast.js') ||
            normalized.endsWith('/src/world/leisure-grove.js') ||
            normalized.endsWith('/src/world/pond-life.js') ||
            normalized.endsWith('/src/world/waterworks.js') ||
            normalized.endsWith('/src/world/people.js') ||
            normalized.endsWith('/src/world/props.js')
          ) return 'village-world';
          if (
            normalized.endsWith('/src/world/ground-surface.js') ||
            normalized.endsWith('/src/world/seasonal-roads.js') ||
            normalized.endsWith('/src/world/static-visibility.js') ||
            normalized.endsWith('/src/world/cave-passage.js') ||
            normalized.endsWith('/src/world/cave-gleam.js') ||
            normalized.endsWith('/src/world/cliff.js') ||
            normalized.endsWith('/src/world/flora.js') ||
            normalized.endsWith('/src/world/scatter.js') ||
            normalized.endsWith('/src/world/boats.js') ||
            normalized.endsWith('/src/world/fish.js') ||
            normalized.endsWith('/src/world/reeds.js') ||
            normalized.endsWith('/src/world/stream.js') ||
            normalized.endsWith('/src/world/rock.js') ||
            normalized.endsWith('/src/world/road-geometry.js')
          ) return 'core-world';
          if (
            normalized.endsWith('/src/systems/phenology-mist.js') ||
            normalized.endsWith('/src/systems/phenology-vignettes.js') ||
            normalized.endsWith('/src/systems/ink-atmosphere.js') ||
            normalized.endsWith('/src/systems/architectural-craft.js') ||
            normalized.endsWith('/src/systems/seasonal-cycle.js') ||
            normalized.endsWith('/src/systems/contact-shadows.js') ||
            normalized.endsWith('/src/systems/flora-wind.js') ||
            normalized.endsWith('/src/systems/sky.js') ||
            normalized.endsWith('/src/systems/twilight-water.js') ||
            normalized.endsWith('/src/systems/rain-water.js') ||
            normalized.endsWith('/src/systems/weather.js')
          ) return 'atmosphere-fx';
          if (
            normalized.endsWith('/src/systems/river-skiff.js') ||
            normalized.endsWith('/src/systems/poetic-interactions.js') ||
            normalized.endsWith('/src/systems/villager-dialogue.js') ||
            normalized.endsWith('/src/systems/fauna.js') ||
            normalized.endsWith('/src/systems/fauna-models.js') ||
            normalized.endsWith('/src/systems/community-life.js') ||
            normalized.endsWith('/src/systems/neighbor-theaters.js') ||
            normalized.endsWith('/src/systems/seasonal-gathering.js') ||
            normalized.endsWith('/src/systems/situational-rest.js') ||
            normalized.endsWith('/src/systems/map.js') ||
            normalized.endsWith('/src/systems/journal.js') ||
            normalized.endsWith('/src/systems/discovery.js') ||
            normalized.endsWith('/src/systems/discovery-targets.js') ||
            normalized.endsWith('/src/systems/catalogue.js') ||
            normalized.endsWith('/src/systems/god-flight.js') ||
            normalized.endsWith('/src/systems/traveler-guide-cruise.js') ||
            normalized.endsWith('/src/systems/poetic-wayfinder.js') ||
            normalized.endsWith('/src/systems/quest-system.js')
          ) return 'gameplay-systems';
          if (
            normalized.endsWith('/src/player/avatar.js') ||
            normalized.endsWith('/src/player/controller.js') ||
            normalized.endsWith('/src/player/touch-controls-lazy.js') ||
            normalized.endsWith('/src/systems/opening-curtain.js') ||
            normalized.endsWith('/src/systems/footstep-fx.js') ||
            normalized.endsWith('/src/systems/world-clock.js') ||
            normalized.endsWith('/src/systems/tactile-props.js') ||
            normalized.endsWith('/src/systems/interaction.js') ||
            normalized.endsWith('/src/systems/field-guide.js') ||
            normalized.endsWith('/src/systems/modal-state.js') ||
            normalized.endsWith('/src/systems/scroll-studio-lazy.js') ||
            normalized.endsWith('/src/bootstrap/portal-visibility.js') ||
            normalized.endsWith('/src/bootstrap/world-registry.js')
          ) return 'core-runtime';
        }
      }
    }
  }
});
