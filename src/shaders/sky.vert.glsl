// Skydome: render a big inverted sphere, pass the view direction to the
// fragment shader so it can paint a gradient + sun/moon disc.
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  // strip translation so the dome is locked to the camera (infinite sky)
  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // force depth to far plane
}
