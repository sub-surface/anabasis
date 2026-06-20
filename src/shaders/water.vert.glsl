// Low-poly PS1 water surface. Gentle crossing swells, NO hard vertex snap
// (the coarse terrain snap on this large sparse plane produced a stairstep
// grid) — the scrolling fragment reflections carry the retro feel instead.
uniform float uTime;
varying vec2 vUv;
varying float vFog;
varying float vDist;

void main() {
  vUv = uv;
  vec3 pos = position;
  // several small crossing swells — finer and lower-amplitude than before
  pos.y += sin(pos.x * 0.018 + uTime * 1.1) * 0.8
         + cos(pos.z * 0.022 - uTime * 0.9) * 0.7
         + sin((pos.x + pos.z) * 0.05 + uTime * 1.6) * 0.3;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFog = -mv.z;
  vDist = length(pos.xz); // distance from centre, for edge fade
  gl_Position = projectionMatrix * mv;
}
