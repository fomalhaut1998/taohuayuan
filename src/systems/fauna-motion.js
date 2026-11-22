import * as THREE from 'three';
import { chainProgramCacheKey } from './shader-cache-key.js';

export const FAUNA_MOTION_DEFAULTS = Object.freeze({
  maxStep: 0.05, headIdle: 0.055, peck: 1.35, tailIdle: 0.18,
  wingIdle: 0.065, wingFlight: 1.05, wingFrequency: 2.4, paddle: 0.6
});
export const FAUNA_KIND = Object.freeze({ chicken: 0, dog: 1, bird: 2, ox: 3, duck: 4 });

// Same piecewise angle law is exposed for deterministic, GPU-free contract tests.
// State = phase, gait blend, current species reaction, species id.
export function faunaPartAngle(motion, state, options = FAUNA_MOTION_DEFAULTS) {
  const [channel, amplitude, offset] = motion;
  const [phase, rawGait, reaction, kind] = state;
  const gait = Math.max(0, rawGait);
  const sleep = Math.max(0, -rawGait);
  const awake = Math.max(0, 1 - sleep);
  const wave = Math.sin(phase + offset);
  let angle = 0;
  if (channel === 1) {
    const headSleep = kind === FAUNA_KIND.dog ? 1.44 : kind === FAUNA_KIND.ox ? 0.30 : 0.22;
    angle = wave * options.headIdle * awake + sleep * headSleep;
    if (kind === FAUNA_KIND.chicken) angle += Math.pow(Math.max(0, Math.sin(phase * 0.7)), 6) * options.peck * (1 - gait) * (1 - reaction) * awake;
    if (kind === FAUNA_KIND.ox) angle += reaction;
  } else if (channel === 2) {
    angle = wave * options.tailIdle * awake;
    if (kind === FAUNA_KIND.dog) angle += reaction + sleep * 4.7;
    else if (kind === FAUNA_KIND.ox) angle += sleep * 2.1;
  } else if (channel === 3) {
    const legSleep = kind === FAUNA_KIND.dog ? -3.47 : kind === FAUNA_KIND.ox ? 6.9 : 4.6;
    angle = wave * gait + sleep * legSleep;
  } else if (channel === 4) angle = Math.sin(phase * options.wingFrequency + offset) * (options.wingIdle * awake + reaction * options.wingFlight);
  else if (channel === 5) angle = wave * options.paddle * (0.25 * awake + gait) + sleep * 2.6;
  return angle * amplitude;
}

export function createFaunaMaterial(config = {}) {
  const options = { ...FAUNA_MOTION_DEFAULTS, ...config };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.name = 'fauna-faceted-articulation';
  material.userData.motion = options;
  chainProgramCacheKey(material, 'fauna-rigid-parts-v2');
  material.onBeforeCompile = shader => {
    shader.uniforms.faunaHeadIdle = { value: options.headIdle };
    shader.uniforms.faunaPeck = { value: options.peck };
    shader.uniforms.faunaTailIdle = { value: options.tailIdle };
    shader.uniforms.faunaWingIdle = { value: options.wingIdle };
    shader.uniforms.faunaWingFlight = { value: options.wingFlight };
    shader.uniforms.faunaWingFrequency = { value: options.wingFrequency };
    shader.uniforms.faunaPaddle = { value: options.paddle };
    const declaration = `
attribute vec3 faunaPivot;
attribute vec3 faunaAxis;
attribute vec3 faunaMotion;
attribute vec4 faunaState;
uniform float faunaHeadIdle, faunaPeck, faunaTailIdle;
uniform float faunaWingIdle, faunaWingFlight, faunaWingFrequency, faunaPaddle;
float faunaAngle() {
  float channel = faunaMotion.x;
  float phase = faunaState.x;
  float rawGait = faunaState.y;
  float gait = max(0.0, rawGait);
  float sleep = max(0.0, -rawGait);
  float awake = max(0.0, 1.0 - sleep);
  float reaction = faunaState.z;
  float kind = faunaState.w;
  float wave = sin(phase + faunaMotion.z);
  float angle = 0.0;
  if (channel > 0.5 && channel < 1.5) {
    float headSleep = 0.22;
    if (kind > 0.5 && kind < 1.5) headSleep = 1.44;
    else if (kind > 2.5 && kind < 3.5) headSleep = 0.30;
    angle = wave * faunaHeadIdle * awake + sleep * headSleep;
    if (kind < 0.5) angle += pow(max(0.0, sin(phase * 0.7)), 6.0) * faunaPeck * (1.0 - gait) * (1.0 - reaction) * awake;
    if (kind > 2.5 && kind < 3.5) angle += reaction;
  } else if (channel > 1.5 && channel < 2.5) {
    angle = wave * faunaTailIdle * awake;
    if (kind > 0.5 && kind < 1.5) angle += reaction + sleep * 4.7;
    else if (kind > 2.5 && kind < 3.5) angle += sleep * 2.1;
  } else if (channel > 2.5 && channel < 3.5) {
    float legSleep = 4.6;
    if (kind > 0.5 && kind < 1.5) legSleep = -3.47;
    else if (kind > 2.5 && kind < 3.5) legSleep = 6.9;
    angle = wave * gait + sleep * legSleep;
  } else if (channel > 3.5 && channel < 4.5) angle = sin(phase * faunaWingFrequency + faunaMotion.z) * (faunaWingIdle * awake + reaction * faunaWingFlight);
  else if (channel > 4.5) angle = wave * faunaPaddle * (0.25 * awake + gait) + sleep * 2.6;
  return angle * faunaMotion.y;
}
vec3 faunaRotate(vec3 v, float angle) {
  float c = cos(angle), s = sin(angle);
  return v * c + cross(faunaAxis, v) * s + faunaAxis * dot(faunaAxis, v) * (1.0 - c);
}
`;
    for (const chunk of ['<common>', '<beginnormal_vertex>', '<begin_vertex>']) {
      if (!shader.vertexShader.includes('#include ' + chunk)) throw new Error('Fauna shader contract missing ' + chunk);
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + declaration)
      .replace('#include <beginnormal_vertex>', 'float faunaJointAngle = faunaAngle();\n#include <beginnormal_vertex>\nobjectNormal = faunaRotate(objectNormal, faunaJointAngle);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = faunaPivot + faunaRotate(transformed - faunaPivot, faunaJointAngle);');
  };
  return material;
}

export function attachFaunaState(geometry, count) {
  const state = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('faunaState', state);
  return state;
}

// CPU mirror of Rodrigues' rigid transform. Normals must use the same rotation
// but no pivot/translation; useful for testing every vertex, including horns.
export function sampleFaunaVertex(geometry, index, state, options = FAUNA_MOTION_DEFAULTS) {
  const get = name => new THREE.Vector3().fromBufferAttribute(geometry.attributes[name], index);
  const motion = get('faunaMotion'), pivot = get('faunaPivot'), axis = get('faunaAxis');
  const angle = faunaPartAngle(motion.toArray(), state, options);
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  return { position: get('position').sub(pivot).applyQuaternion(q).add(pivot), normal: get('normal').applyQuaternion(q) };
}
