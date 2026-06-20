// Per-biome gradient sky with a sun disc (and a moon at night).
// Cheap: pure direction math, banded to match the PS1 terrain.
precision highp float;

uniform vec3  uLightDir;   // sun direction (same as terrain)
uniform vec3  uSkyTop;     // biome zenith colour
uniform vec3  uSkyHorizon; // biome horizon colour
uniform vec3  uSunColor;
uniform float uNight;      // 0 day -> 1 night
uniform float uEarth;      // 1 = draw the Earth (lunar biome)

varying vec3 vDir;

// 4x4 ordered dither, matched to the terrain — softens gradient banding
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int idx = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == idx) v = m[k]; }
  return v / 16.0 - 0.5;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

  // vertical gradient, horizon warmer/brighter
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(up, 0.8));

  // --- sun disc + glow ---
  float sd = dot(dir, normalize(uLightDir));
  float sun = smoothstep(0.9975, 0.9990, sd);       // crisp disc
  float glow = pow(max(sd, 0.0), 64.0) * 0.6;        // soft halo
  col += uSunColor * (sun * 1.4 + glow);

  // --- moon at night: opposite the sun, pale, with a faint ring ---
  if (uNight > 0.4) {
    float md = dot(dir, normalize(-uLightDir));
    float moon = smoothstep(0.9980, 0.9992, md);
    float mglow = pow(max(md, 0.0), 200.0) * 0.3;
    vec3 moonCol = vec3(0.82, 0.85, 0.92);
    col += moonCol * (moon * 1.1 + mglow) * smoothstep(0.4, 0.8, uNight);

    // a scatter of cheap stars high in the sky
    if (dir.y > 0.2) {
      vec2 g = floor(dir.xz * 120.0);
      float s = fract(sin(dot(g, vec2(12.99, 78.23))) * 43758.55);
      float star = step(0.997, s) * smoothstep(0.4, 1.0, uNight) * smoothstep(0.2, 0.5, dir.y);
      col += vec3(star);
    }
  }

  // --- lunar biome: airless black sky, permanent stars + a hanging Earth ---
  if (uEarth > 0.5) {
    // stars everywhere above the horizon (no atmosphere to wash them out)
    if (dir.y > 0.05) {
      vec2 g = floor(dir.xz * 140.0);
      float s = fract(sin(dot(g, vec2(12.99, 78.23))) * 43758.55);
      col += vec3(step(0.992, s)) * smoothstep(0.05, 0.3, dir.y);
    }
    // Earth: a fixed blue marble high in one quarter of the sky
    vec3 earthDir = normalize(vec3(0.45, 0.62, -0.65));
    float ed = dot(dir, earthDir);
    float disc = smoothstep(0.9965, 0.9978, ed);
    if (disc > 0.0) {
      // crude continents/ocean from noise-ish bands on the disc surface.
      // 'local' is the offset from the Earth's centre direction; use its 2D
      // projection (xy) for the surface pattern lookups.
      vec3 local = dir - earthDir;
      vec2 luv = local.xy * vec2(1.0, 1.0);
      float land = step(0.5, fract(sin(dot(floor(luv * 600.0), vec2(7.1, 3.7))) * 4181.0));
      vec3 ocean = vec3(0.16, 0.34, 0.62);
      vec3 landC = vec3(0.30, 0.46, 0.32);
      vec3 cloud = vec3(0.85, 0.88, 0.92);
      float cl = step(0.7, fract(sin(dot(floor(luv * 250.0), vec2(2.3, 9.4))) * 9133.0));
      vec3 earthCol = mix(mix(ocean, landC, land), cloud, cl * 0.6);
      // simple day/night terminator across the marble
      float lit = smoothstep(-0.3, 0.4, dot(earthDir, normalize(uLightDir)));
      col = mix(col, earthCol * (0.3 + 0.7 * lit), disc);
    }
    float glow = pow(max(ed, 0.0), 600.0) * 0.25;       // faint halo
    col += vec3(0.3, 0.45, 0.7) * glow;
  }

  // band the sky to match the terrain's posterised look, but dither the
  // gradient so the steps read as a soft 16-bit ramp, not hard bands.
  float levels = 32.0;
  col = floor((col + bayer(gl_FragCoord.xy) / levels) * levels) / levels;

  gl_FragColor = vec4(col, 1.0);
}
