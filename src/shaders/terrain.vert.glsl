// PS1-style terrain vertex shader.
// - displaces a flat grid by a heightmap derived from the source image
// - reshapes that height through a selectable relief algorithm
// - snaps vertex positions to a low-res grid (the iconic PS1 "wobble")
// - computes lighting PER VERTEX (Gourad) — cheap, and exactly the era's look

uniform sampler2D uHeight;   // luminance heightfield
uniform sampler2D uColor;    // source image colour (for "memory residue" tint)
uniform float uRelief;       // vertical exaggeration
uniform float uReliefCurve;  // 0 linear, 1 eroded, 2 terraced, 3 ridged
uniform float uWaterLevel;   // normalised height of the sea
uniform float uSnap;         // grid-snap resolution (higher = blockier)
uniform vec3  uLightDir;     // time-of-day sun direction
uniform float uTime;

varying float vHeight;       // shaped terrain height (for fragment colouring)
varying float vFog;          // camera-distance fog factor
varying vec3 vTint;          // sampled source colour — the photo's ghost
varying float vLight;        // per-vertex lambert term
varying float vWet;          // 1 below water line
varying float vSlope;        // 0 = flat, 1 = vertical cliff
varying float vWorldH;       // displaced world height (post-relief)
varying vec2  vWorldXZ;      // world-plane position, for stable surface noise

float lum(vec2 uv) {
  vec3 c = texture2D(uHeight, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// relief algorithms: reshape the raw luminance into terrain of a given character
float shape(float h) {
  int c = int(uReliefCurve + 0.5);
  if (c == 1) {
    // eroded: smooth valleys, detail accumulates low (gentle power curve)
    return pow(h, 1.7);
  } else if (c == 2) {
    // terraced: quantised plateaus, like sedimentary strata / rice terraces
    float steps = 7.0;
    float t = floor(h * steps) / steps;
    return mix(t, h, 0.25); // soften the risers a touch
  } else if (c == 3) {
    // ridged: sharp mountain crests (classic 1-|2h-1| inversion)
    return 1.0 - abs(h * 2.0 - 1.0);
  }
  return h; // linear
}

void main() {
  vec2 uv = uv;

  float raw = lum(uv);
  float h = shape(raw);
  vHeight = h;
  vTint = texture2D(uColor, uv).rgb;

  // normal from neighbouring SHAPED heights (finite differences)
  float texel = 1.0 / 256.0;
  float hx = shape(lum(uv + vec2(texel, 0.0))) - shape(lum(uv - vec2(texel, 0.0)));
  float hy = shape(lum(uv + vec2(0.0, texel))) - shape(lum(uv - vec2(0.0, texel)));
  vec3 normal = normalize(vec3(-hx * uRelief, 1.0, -hy * uRelief));
  vLight = max(dot(normal, uLightDir), 0.0) * 0.8 + 0.2;

  // slope: 0 facing up, ->1 on cliffs (Terragen-style snow/rock masking)
  vSlope = 1.0 - normal.y;

  // water: clamp anything below the sea line down to it, mark it wet
  float displaced = h;
  vWet = 0.0;
  if (h < uWaterLevel) {
    displaced = uWaterLevel;
    vWet = 1.0;
  }

  vec3 pos = position;
  pos.y += (displaced - 0.5) * uRelief * 40.0;
  vWorldH = pos.y;
  vWorldXZ = position.xz; // stable across camera motion (object space == world here)

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);

  // --- PS1 vertex snap: quantise position in view space ---
  float grid = uSnap;
  mv.xyz = floor(mv.xyz * grid) / grid;

  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}
