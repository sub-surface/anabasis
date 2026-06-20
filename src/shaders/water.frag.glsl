// PS1 water: scrolling fake-reflection bands, sun glint, fog-matched.
precision highp float;

uniform float uTime;
uniform vec3  uWaterColor;
uniform vec3  uSunColor;
uniform vec3  uLightDir;
uniform vec3  uFogColor;
uniform float uFogDensity;

varying vec2 vUv;
varying float vFog;
varying float vDist;

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float bayer(vec2 p){
  int x=int(mod(p.x,4.0)),y=int(mod(p.y,4.0)); int idx=x+y*4;
  float m[16];
  m[0]=0.0;m[1]=8.0;m[2]=2.0;m[3]=10.0;m[4]=12.0;m[5]=4.0;m[6]=14.0;m[7]=6.0;
  m[8]=3.0;m[9]=11.0;m[10]=1.0;m[11]=9.0;m[12]=15.0;m[13]=7.0;m[14]=13.0;m[15]=5.0;
  float v=0.0; for(int k=0;k<16;k++){ if(k==idx) v=m[k]; } return v/16.0-0.5;
}

void main() {
  // scrolling reflection bands
  vec2 p = vUv * 40.0;
  float bands = vnoise(p + vec2(uTime * 0.3, uTime * 0.12));
  bands += vnoise(p * 2.0 - vec2(uTime * 0.2, 0.0)) * 0.5;
  bands /= 1.5;

  vec3 col = mix(uWaterColor * 0.7, uWaterColor * 1.25, smoothstep(0.4, 0.7, bands));

  // sun glint sparkle
  float glint = smoothstep(0.82, 0.97, bands) * max(uLightDir.y, 0.0);
  col += uSunColor * glint * 0.6;

  col *= mix(0.6, 1.0, max(uLightDir.y, 0.1)); // dim at night

  // fog to match terrain
  float f = uFogDensity * vFog * 0.012;
  float fog = clamp(1.0 - exp(-f * f), 0.0, 1.0);

  // fade the far edge of the water plane into the fog so it never reads as a
  // hard-edged grid sitting in space — it dissolves into the horizon.
  float edge = smoothstep(700.0, 1500.0, vDist);
  fog = max(fog, edge);

  col = mix(col, uFogColor, fog);

  float levels = 32.0;
  col = floor((col + bayer(gl_FragCoord.xy) / levels) * levels) / levels;
  gl_FragColor = vec4(col, 1.0);
}
