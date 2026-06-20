// Per-biome gradient sky with a sun disc (and a moon at night).
// Cheap: pure direction math, banded to match the PS1 terrain.
precision highp float;

uniform vec3  uLightDir;   // sun direction (same as terrain)
uniform vec3  uSkyTop;     // biome zenith colour
uniform vec3  uSkyHorizon; // biome horizon colour
uniform vec3  uSunColor;
uniform float uNight;      // 0 day -> 1 night

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

  // band the sky to match the terrain's posterised look, but dither the
  // gradient so the steps read as a soft 16-bit ramp, not hard bands.
  float levels = 32.0;
  col = floor((col + bayer(gl_FragCoord.xy) / levels) * levels) / levels;

  gl_FragColor = vec4(col, 1.0);
}
