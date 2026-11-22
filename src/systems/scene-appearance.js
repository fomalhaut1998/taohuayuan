import * as THREE from 'three';

// No clock, DOM, scene traversal or geometry edits. Preserve the shared fragment
// audit/hook contract; round5 sky keeps its albedo uniform at identity (zero).
const installed = new WeakMap();
const COLOR_CHUNK = '#include <color_fragment>';
const APPEARANCE_CHUNK = COLOR_CHUNK + '\n' +
  'float skyAlbedoLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\n' +
  'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(skyAlbedoLuma), uSkyDesaturation);';

export function skyDesaturation(starOpacity, nightStarOpacity) {
  // Keep the public signature and audited fragment hook; round5 restores the
  // original saturated albedo in every phase/weather. Lighting provides colour.
  return 0;
}

export function installSkyAppearance(material, desaturationUniform) {
  if (installed.has(material)) return null;
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  // Capture before wrapping: Three's default key reads this.onBeforeCompile.
  const baseKey = previousKey.call(material);
  function hook(shader, renderer) {
    previousHook.call(this, shader, renderer);
    if (!shader.fragmentShader.includes(COLOR_CHUNK)) {
      throw new Error('Sky appearance shader contract missing color_fragment');
    }
    shader.uniforms.uSkyDesaturation = desaturationUniform;
    shader.fragmentShader = 'uniform float uSkyDesaturation;\n' +
      shader.fragmentShader.replace(COLOR_CHUNK, APPEARANCE_CHUNK);
  }
  const key = function () { return baseKey + '|sky-albedo-v1'; };
  const record = { previousHook, hook };
  installed.set(material, record);
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = key;
  material.needsUpdate = true;
  return function restore() {
    if (installed.get(material) !== record) return;
    installed.delete(material);
    // Do not overwrite a later owner's replacement hook or cache policy.
    if (material.onBeforeCompile === hook) material.onBeforeCompile = previousHook;
    if (material.customProgramCacheKey === key) material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
  };
}

// A forged userData flag cannot opt a vertex-changing shader into static culling.
// Composed pre-existing custom hooks are intentionally not part of this audit.
export function isSkyAppearanceMaterial(material) {
  const record = installed.get(material);
  return !!record && material.onBeforeCompile === record.hook &&
    record.previousHook === THREE.Material.prototype.onBeforeCompile;
}
