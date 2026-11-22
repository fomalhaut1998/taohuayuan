import * as THREE from 'three';

/**
 * Chain a customProgramCacheKey tag onto a Three.js Material without clobbering
 * any previously installed key function (sky appearance, wind, progressive snow, etc.).
 * Returns a restorer function for clean teardown if needed.
 */
export function chainProgramCacheKey(material, tag) {
  if (!material || typeof tag !== 'string' || !tag) return () => {};
  const prevKeyFn = material.customProgramCacheKey;
  const hasCustomPrev =
    typeof prevKeyFn === 'function' &&
    prevKeyFn !== THREE.Material.prototype.customProgramCacheKey;
  const chainedKey = function customProgramCacheKeyChained() {
    const prefix = hasCustomPrev ? prevKeyFn.call(this) : '';
    return prefix ? `${prefix}|${tag}` : tag;
  };
  material.customProgramCacheKey = chainedKey;
  return function restoreProgramCacheKey() {
    if (material.customProgramCacheKey === chainedKey) {
      material.customProgramCacheKey = prevKeyFn;
    }
  };
}
