// PS1/PS2-style terrain fragment shader.
// Cheap by construction. Adds, all in per-pixel math (no textures):
//  - biome palettes
//  - Terragen-style altitude+slope snow/rock with fuzzy zones
//  - a few octaves of value-noise FBM for surface grain (the "land" feel)
//  - fake ambient occlusion in the lowlands
//  - time-of-day sun/fog tint
//  - exponential Silent-Hill fog + ordered-dither posterisation

precision highp float;

uniform float uFogDensity;
uniform vec3  uFogColor;
uniform vec3  uSunColor;
uniform vec3  uLightDir;
uniform float uWaterLevel;
uniform float uNight;
uniform float uSnowLine;
uniform float uTint;
uniform float uDetail;    // strength of FBM surface grain
uniform float uHaze;      // aerial perspective strength
uniform float uEco;       // how much the source image hue drives ecology
uniform float uGlitch;    // datamosh / corrupted-terrain amount
uniform int   uBiome;     // 0 alpine 1 desert 2 tundra 3 volcanic 4 verdant ...
uniform float uScan;      // wireframe-scan style toggle (0/1)
uniform float uTime;
uniform vec2  uResolution;

varying float vHeight;
varying float vFog;
varying vec3 vTint;
varying float vLight;
varying float vWet;
varying float vSlope;
varying float vWorldH;
varying vec2  vWorldXZ;

// --- cheap value noise + 3-octave FBM (no texture lookups) ---
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1,0));
  float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// biome stop colours: low, mid, high, snow, shore (band kissing the water)
void biome(out vec3 lo, out vec3 mid, out vec3 hi, out vec3 snow, out vec3 shore) {
  if (uBiome == 1) {        // desert — pale dunes, white-gold beach
    lo = vec3(0.55,0.42,0.27); mid = vec3(0.62,0.48,0.30); hi = vec3(0.70,0.58,0.42); snow = vec3(0.78,0.72,0.60); shore = vec3(0.85,0.78,0.58);
  } else if (uBiome == 2) { // tundra — grey-green, frozen grey shore
    lo = vec3(0.34,0.38,0.36); mid = vec3(0.42,0.44,0.42); hi = vec3(0.55,0.56,0.56); snow = vec3(0.88,0.90,0.93); shore = vec3(0.58,0.60,0.62);
  } else if (uBiome == 3) { // volcanic — black rock, dark ash shore
    lo = vec3(0.16,0.13,0.13); mid = vec3(0.24,0.18,0.17); hi = vec3(0.34,0.24,0.22); snow = vec3(0.50,0.30,0.20); shore = vec3(0.20,0.16,0.15);
  } else if (uBiome == 4) { // verdant — lush, reedy green-tan shore
    lo = vec3(0.20,0.33,0.18); mid = vec3(0.28,0.40,0.22); hi = vec3(0.45,0.46,0.34); snow = vec3(0.82,0.84,0.86); shore = vec3(0.62,0.58,0.40);
  } else if (uBiome == 5) { // coral — turquoise shallows, white sand, bleached reef
    lo = vec3(0.42,0.62,0.55); mid = vec3(0.58,0.70,0.55); hi = vec3(0.70,0.66,0.52); snow = vec3(0.92,0.86,0.78); shore = vec3(0.92,0.88,0.74);
  } else if (uBiome == 6) { // salt flat — near-white cracked playa
    lo = vec3(0.72,0.70,0.66); mid = vec3(0.80,0.78,0.74); hi = vec3(0.86,0.84,0.80); snow = vec3(0.93,0.92,0.90); shore = vec3(0.84,0.82,0.78);
  } else if (uBiome == 7) { // lunar — grey regolith, airless
    lo = vec3(0.22,0.22,0.24); mid = vec3(0.34,0.34,0.36); hi = vec3(0.48,0.48,0.50); snow = vec3(0.62,0.62,0.64); shore = vec3(0.30,0.30,0.32);
  } else if (uBiome == 8) { // megastructure — concrete & steel arcology
    lo = vec3(0.20,0.21,0.24); mid = vec3(0.30,0.31,0.34); hi = vec3(0.42,0.43,0.47); snow = vec3(0.55,0.57,0.62); shore = vec3(0.26,0.27,0.30);
  } else if (uBiome == 9) { // toxic — oily black, magenta-amber waste
    lo = vec3(0.18,0.12,0.16); mid = vec3(0.30,0.16,0.18); hi = vec3(0.42,0.26,0.16); snow = vec3(0.55,0.45,0.20); shore = vec3(0.28,0.14,0.18);
  } else {                  // alpine (default) — pale pebble shore
    lo = vec3(0.36,0.39,0.29); mid = vec3(0.45,0.43,0.36); hi = vec3(0.52,0.50,0.47); snow = vec3(0.86,0.88,0.92); shore = vec3(0.60,0.58,0.50);
  }
}


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

// luminance helper
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec3 base;
  vec3 lo, mid, hi, snowCol, shoreCol; biome(lo, mid, hi, snowCol, shoreCol);

  // ecology: the photo's hue leaks back as moisture/greenness — a wrong reading
  // the renderer makes of the image. Kept gentle so the BIOME stays dominant.
  float greenish = clamp((vTint.g - max(vTint.r, vTint.b)) * 2.0, 0.0, 1.0);
  vec3 ecoLo = mix(lo, vec3(0.22, 0.34, 0.18), greenish * uEco * 0.6);
  vec3 ecoMid = mix(mid, vec3(0.30, 0.40, 0.22), greenish * uEco * 0.4);

  if (vWet > 0.5) {
    float ripple = sin((vWorldXZ.x + vWorldXZ.y) * 0.08 + uTime * 1.5) * 0.015;
    base = mix(lo * 0.4, vec3(0.10,0.17,0.23), 0.7) + ripple;
    base = mix(base, vTint * 0.3, uTint * 0.5);

    // sun glint: a moving sparkle band on the water where light catches it
    float sparkle = fbm(vWorldXZ * 0.4 + uTime * 0.6);
    float glint = smoothstep(0.78, 0.95, sparkle) * max(uLightDir.y, 0.0);
    base += uSunColor * glint * 0.5;
  } else {
    // base palette with gently ecology-adjusted low bands
    base = mix(ecoLo, ecoMid, smoothstep(0.30, 0.50, vHeight));
    base = mix(base, hi, smoothstep(0.55, 0.80, vHeight));

    // --- shoreline: a band of beach/scree just above the water line ---
    // per-biome shore colour, faded out as we climb away from the sea.
    float shoreBand = smoothstep(0.0, 0.05, vHeight - uWaterLevel)
                    * (1.0 - smoothstep(0.05, 0.12, vHeight - uWaterLevel));
    base = mix(base, shoreCol, shoreBand * 0.8);

    // --- world-anchored surface grain (stable across camera motion) ---
    // applied as a BRIGHTNESS variation, so it adds texture without muddying hue.
    float fine = fbm(vWorldXZ * 0.18) - 0.5;          // tight grain
    float broad = fbm(vWorldXZ * 0.035) - 0.5;        // large undulation
    float grain = fine * 0.6 + broad * 0.4;
    float accum = 1.0 / (1.0 + vSlope * 5.0);
    base *= 1.0 + grain * uDetail * 0.35 * accum;

    // --- lateral colour variation: large-scale tint drift across the land ---
    float region = fbm(vWorldXZ * 0.012 + 7.0);
    base = mix(base, base * vec3(1.05, 1.0, 0.92), (region - 0.5) * uDetail);

    // Terragen: snow by altitude AND slope, fuzzy zones
    float altMask  = smoothstep(uSnowLine, uSnowLine + 0.12, vHeight);
    float slopeMask = 1.0 - smoothstep(0.35, 0.65, vSlope);
    float snowAmt = altMask * slopeMask;
    base = mix(base, snowCol, snowAmt);

    // exposed rock on steep faces
    float rockMask = smoothstep(0.45, 0.75, vSlope) * 0.6;
    base = mix(base, mix(mid, vec3(0.28), 0.5), rockMask);

    // fake AO in lowlands / concavities
    float ao = mix(0.72, 1.0, smoothstep(0.25, 0.6, vHeight));
    base *= ao;

    // snow sheen: faint specular where the sun rakes the snow
    base += uSunColor * snowAmt * max(vLight - 0.7, 0.0) * 0.4;

    // --- megastructure: emissive window grid on the built surface ---
    if (uBiome == 8) {
      vec2 cell = floor(vWorldXZ * 0.25);
      float lit = step(0.78, hash(cell));                 // ~22% of cells lit
      float windowMask = step(0.3, fract(vWorldXZ.x * 0.25)) * step(0.3, fract(vWorldXZ.y * 0.25));
      base += vec3(0.9, 0.8, 0.5) * lit * windowMask * (0.35 + uNight * 0.9);
    }
    // --- toxic: sickly neon rim where slopes catch the light ---
    if (uBiome == 9) {
      float rim = smoothstep(0.3, 0.6, vSlope);
      base += vec3(0.7, 0.1, 0.5) * rim * 0.25;
    }

    // tint as a gentle OVERLAY (luminance-locked) so it textures without
    // repainting the biome. This is the fix for "every biome looks the same".
    float tl = luma(vTint);
    base = mix(base, base * (0.6 + tl * 0.8), uTint);
  }

  // --- glitch / datamosh: corrupt the colour in blocky bands ---
  if (uGlitch > 0.001) {
    float band = floor(vWorldXZ.y * 0.08 + uTime * 0.5);
    float g = hash(vec2(band, floor(vWorldXZ.x * 0.05)));
    if (g < uGlitch) {
      base = base.gbr;                         // channel-swap corruption
      base += (hash(vec2(band, 3.0)) - 0.5) * 0.4;
    }
  }

  // per-vertex sun light, tinted by time of day
  base *= vLight * uSunColor;

  // --- wireframe scan style: holographic topographic scan over black ---
  if (uScan > 0.5) {
    // grid lines from world position, brighter on height contours
    vec2 g = fract(vWorldXZ * 0.12);
    float grid = max(smoothstep(0.94, 1.0, max(g.x, 1.0 - g.x)),
                     smoothstep(0.94, 1.0, max(g.y, 1.0 - g.y)));
    float contour = smoothstep(0.92, 1.0, fract(vHeight * 14.0));
    vec3 scanCol = vec3(0.2, 0.9, 1.0);                 // cyan
    float scanline = 0.85 + 0.15 * sin(gl_FragCoord.y * 0.7 + uTime * 4.0);
    base = vec3(0.0, 0.02, 0.04)
         + scanCol * (grid * 0.8 + contour * 0.5) * scanline
         + scanCol * max(vLight - 0.5, 0.0) * 0.15;     // faint surface fill
  }

  // --- aerial haze (atmospheric perspective): distant land desaturates and
  // shifts toward the fog/sky colour BEFORE fog proper. Terragen's signature. ---
  float aer = clamp(vFog / 1400.0, 0.0, 1.0) * uHaze;
  vec3 hazeCol = mix(uFogColor, uSunColor, 0.3);
  base = mix(base, mix(base, hazeCol, 0.6), aer);

  // exponential (Silent Hill) fog: deep but heavy falloff, never a hard cut
  float f = uFogDensity * vFog * 0.012;
  float fog = clamp(1.0 - exp(-f * f), 0.0, 1.0);
  base = mix(base, uFogColor, fog);

  // posterise + dither -> 90s console banding, ~free
  float levels = 32.0;
  base = floor((base + bayer(gl_FragCoord.xy) / levels) * levels) / levels;

  gl_FragColor = vec4(base, 1.0);
}
