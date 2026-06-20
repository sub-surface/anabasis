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

  // --- moon at night: opposite the sun, with stars that wheel alongside it ---
  if (uNight > 0.4) {
    float md = dot(dir, normalize(-uLightDir));
    float moon = smoothstep(0.9980, 0.9992, md);
    float mglow = pow(max(md, 0.0), 200.0) * 0.3;
    vec3 moonCol = vec3(0.82, 0.85, 0.92);
    col += moonCol * (moon * 1.1 + mglow) * smoothstep(0.4, 0.8, uNight);

    // stars fixed to the celestial sphere (rotating frame), so they wheel
    // together with the moon as time-of-day advances — not pinned to the view.
    if (dir.y > 0.18) {
      vec3 S = normalize(uLightDir);
      vec3 E = normalize(cross(S, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
      vec3 U = normalize(cross(E, S));
      vec2 g = floor(vec2(dot(dir, E), dot(dir, U)) * 130.0);
      float s = fract(sin(dot(g, vec2(12.99, 78.23))) * 43758.55);
      float star = step(0.997, s) * smoothstep(0.4, 1.0, uNight) * smoothstep(0.18, 0.45, dir.y);
      col += vec3(star);
    }
  }

  // --- lunar biome: airless black sky. Sun, stars and Earth form one
  // celestial sphere that rotates together with time-of-day (uLightDir). ---
  if (uEarth > 0.5) {
    // a basis that rotates WITH the sun, so everything tracks together
    vec3 S = normalize(uLightDir);                       // sun direction
    vec3 E = normalize(cross(S, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
    vec3 U = normalize(cross(E, S));
    // sample direction expressed in the rotating celestial frame
    vec3 cel = vec3(dot(dir, E), dot(dir, U), dot(dir, S));

    // hard brilliant sun disc + tight corona
    float sunDisc = smoothstep(0.9986, 0.9992, sd);
    float corona = pow(max(sd, 0.0), 350.0);
    col += vec3(1.0, 0.98, 0.92) * (sunDisc * 2.5 + corona * 0.5);

    // stars fixed to the celestial sphere (so they wheel with the sun)
    if (dir.y > 0.02) {
      vec2 g = floor(cel.xy * 150.0);
      float s = fract(sin(dot(g, vec2(12.99, 78.23))) * 43758.55);
      col += vec3(step(0.992, s)) * smoothstep(0.02, 0.25, dir.y);
    }

    // Earth: a blue marble at a fixed point on the celestial sphere, ~120°
    // from the sun — so it rises and sets along with everything else.
    vec3 earthDir = normalize(E * 0.6 + U * 0.7 - S * 0.4);
    float ed = dot(dir, earthDir);
    float disc = smoothstep(0.9965, 0.9978, ed);
    if (disc > 0.0) {
      vec3 local = dir - earthDir;
      vec2 luv = vec2(dot(local, E), dot(local, U));     // surface coords in frame
      float land = step(0.5, fract(sin(dot(floor(luv * 600.0), vec2(7.1, 3.7))) * 4181.0));
      vec3 ocean = vec3(0.16, 0.34, 0.62);
      vec3 landC = vec3(0.30, 0.46, 0.32);
      vec3 cloud = vec3(0.85, 0.88, 0.92);
      float cl = step(0.7, fract(sin(dot(floor(luv * 250.0), vec2(2.3, 9.4))) * 9133.0));
      vec3 earthCol = mix(mix(ocean, landC, land), cloud, cl * 0.6);
      // terminator: the Earth's lit side faces the sun
      float lit = smoothstep(-0.3, 0.5, dot(earthDir, S));
      col = mix(col, earthCol * (0.3 + 0.7 * lit), disc);
    }
    col += vec3(0.3, 0.45, 0.7) * pow(max(ed, 0.0), 600.0) * 0.25; // halo
  }

  // band the sky to match the terrain's posterised look, but dither the
  // gradient so the steps read as a soft 16-bit ramp, not hard bands.
  float levels = 32.0;
  col = floor((col + bayer(gl_FragCoord.xy) / levels) * levels) / levels;

  gl_FragColor = vec4(col, 1.0);
}
