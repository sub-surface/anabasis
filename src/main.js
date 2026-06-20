// OROGENESIS — landscapes without memory
// After Joan Fontcuberta: feed the machine an image, it forgets the image and
// hallucinates the only kind of world it knows. PS1-era terrain renderer.

import * as THREE from 'three'
import terrainVert from './shaders/terrain.vert.glsl?raw'
import terrainFrag from './shaders/terrain.frag.glsl?raw'
import skyVert from './shaders/sky.vert.glsl?raw'
import skyFrag from './shaders/sky.frag.glsl?raw'
import waterVert from './shaders/water.vert.glsl?raw'
import waterFrag from './shaders/water.frag.glsl?raw'

// ---------------------------------------------------------------------------
// constants
const GRID = 192            // heightmesh resolution (low-poly = cheap + PS1)
const PLANE = 800           // world size of the terrain
let lowresScale = 0.5       // render at half res normally (the big perf lever)
const FOG_COLOR = new THREE.Color(0x9aa0a4)

// ---------------------------------------------------------------------------
// renderer + low-res framebuffer
const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1) // never go retina — we WANT chunky pixels
let lowres = true
let capturing = false     // true for the one-frame high-res capture render
let captureScale = 1      // capture supersample factor (set by the 'cap' slider)

const scene = new THREE.Scene()
scene.background = FOG_COLOR

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 1, 4000)
camera.position.set(0, 90, 260)

// orthographic camera for an isometric 3/4 view of the whole world.
// Ortho has no FOV, so "zoom" scales the frustum SPAN instead of focal length.
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000)
let isoMode = false
let isoZoom = 0.62           // smaller span = closer
function frameOrtho() {
  const aspect = innerWidth / innerHeight
  const span = PLANE * isoZoom
  orthoCam.left = -span * aspect; orthoCam.right = span * aspect
  orthoCam.top = span; orthoCam.bottom = -span
  orthoCam.position.set(PLANE * 0.7, PLANE * 0.7, PLANE * 0.7)
  orthoCam.lookAt(0, 0, 0)
  orthoCam.updateProjectionMatrix()
}
const activeCam = () => (isoMode ? orthoCam : camera)

// ---------------------------------------------------------------------------
// terrain material
const uniforms = {
  uHeight:      { value: null },
  uColor:       { value: null },
  uRelief:      { value: 5.5 },
  uReliefCurve: { value: 0 },       // 0 linear 1 eroded 2 terraced 3 ridged
  uWaterLevel:  { value: 0.38 },
  uSnap:        { value: 0.9 },     // lower = more vertex wobble
  uLightDir:    { value: new THREE.Vector3(0.4, 0.9, 0.25).normalize() },
  uTime:        { value: 0 },
  uFogDensity:  { value: 0.31 },
  uFogColor:    { value: FOG_COLOR.clone() },
  uSunColor:    { value: new THREE.Color(1, 1, 1) },
  uSnowLine:    { value: 0.72 },
  uTint:        { value: 0.16 },    // strength of the source-image colour ghost
  uDetail:      { value: 0.55 },    // FBM surface grain strength
  uHaze:        { value: 0.6 },     // aerial perspective
  uEco:         { value: 0.5 },     // image-hue-driven ecology
  uGlitch:      { value: 0.0 },     // datamosh amount
  uBiome:       { value: 0 },
  uNight:       { value: 0 },
  uScan:        { value: 0 },     // wireframe-scan render style
  uResolution:  { value: new THREE.Vector2() },
}

const geometry = new THREE.PlaneGeometry(PLANE, PLANE, GRID, GRID)
geometry.rotateX(-Math.PI / 2)

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: terrainVert,
  fragmentShader: terrainFrag,
  fog: false,
})
const terrain = new THREE.Mesh(geometry, material)
scene.add(terrain)

// --- skydome: gradient + sun/moon, locked to the camera ---
const skyUniforms = {
  uLightDir:   uniforms.uLightDir,          // shared with terrain
  uSunColor:   uniforms.uSunColor,
  uSkyTop:     { value: new THREE.Color(0x2a3a55) },
  uSkyHorizon: { value: new THREE.Color(0x9aa0a4) },
  uNight:      { value: 0 },
  uEarth:      { value: 0 },
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
  })
)
sky.frustumCulled = false
scene.add(sky)

// per-biome sky colours (zenith, horizon)
const SKY_BIOMES = [
  { top: 0x2a3a55, hor: 0x9aa0a4 }, // alpine
  { top: 0x3a4a66, hor: 0xc9b48f }, // desert
  { top: 0x32414f, hor: 0xa8b0b4 }, // tundra
  { top: 0x2a1e22, hor: 0x6b3a30 }, // volcanic
  { top: 0x2f4a60, hor: 0xb0bca0 }, // verdant
  { top: 0x2a6a8a, hor: 0xbfe4dd }, // coral — bright tropical
  { top: 0x6a7a90, hor: 0xd8d4cc }, // salt flat — bleached
  { top: 0x05060a, hor: 0x14141c }, // lunar — black space
  { top: 0x1a1e2a, hor: 0x4a4e58 }, // megastructure — smog
  { top: 0x2a0e1a, hor: 0x7a3a20 }, // toxic — amber-magenta haze
]
const _top = new THREE.Color(), _hor = new THREE.Color(), _nightSky = new THREE.Color(0x0a0e18)
function applyBiomeSky(i) {
  const b = SKY_BIOMES[i] || SKY_BIOMES[0]
  // by day use the biome sky; at night fade toward deep blue, horizon -> fog
  const n = (typeof nightFactor === 'number') ? nightFactor : 0
  _top.setHex(b.top).lerp(_nightSky, n * 0.85)
  _hor.setHex(b.hor).lerp(uniforms.uFogColor.value, n * 0.7)
  skyUniforms.uSkyTop.value.copy(_top)
  skyUniforms.uSkyHorizon.value.copy(_hor)
}

// --- water surface: a low-poly PS1 sea plane at the water level ---
const WATER_BIOMES = [
  0x16313f, // alpine
  0x1d4a55, // desert
  0x1a2e3a, // tundra
  0x241a14, // volcanic
  0x1c3a44, // verdant
  0x2aa8a0, // coral — turquoise
  0x8a9090, // salt flat — pale brine
  0x10131a, // lunar — near-black (no real water)
  0x14181f, // megastructure — dark coolant
  0x2a1020, // toxic — magenta sludge
]
const waterUniforms = {
  uTime:       uniforms.uTime,
  uWaterColor: { value: new THREE.Color(WATER_BIOMES[0]) },
  uSunColor:   uniforms.uSunColor,
  uLightDir:   uniforms.uLightDir,
  uFogColor:   uniforms.uFogColor,
  uFogDensity: uniforms.uFogDensity,
}
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(PLANE * 2.2, PLANE * 2.2, 80, 80),
  new THREE.ShaderMaterial({
    uniforms: waterUniforms, vertexShader: waterVert, fragmentShader: waterFrag,
  })
)
water.geometry.rotateX(-Math.PI / 2)
scene.add(water)
function updateWaterLevel() {
  // mirror the terrain's height mapping: (level-0.5)*relief*40
  water.position.y = (uniforms.uWaterLevel.value - 0.5) * uniforms.uRelief.value * 40.0 + 0.5
}

// --- minimap: the imported image with a live camera marker ---
let sourceImage = null
const minimap = document.getElementById('minimap')
const mmCtx = minimap.getContext('2d')
// size the minimap canvas to the image's aspect ratio (longest side ~144px)
function sizeMinimap() {
  if (!sourceImage) return
  const ar = sourceImage.width / sourceImage.height
  const long = 144
  if (ar >= 1) { minimap.width = long; minimap.height = Math.round(long / ar) }
  else { minimap.height = long; minimap.width = Math.round(long * ar) }
}
function drawMinimap() {
  if (!sourceImage) return
  const w = minimap.width, h = minimap.height
  mmCtx.clearRect(0, 0, w, h)
  // draw the whole image at its true ratio (opacity handled by CSS so it can
  // fade on hover); fully opaque on the canvas itself.
  mmCtx.drawImage(sourceImage, 0, 0, w, h)

  // terrain uses a CENTRE-SQUARE crop of the image, so the rendered region is
  // the central square of the minimap. Map the camera into that square.
  const sq = Math.min(w, h)
  const ox = (w - sq) / 2, oy = (h - sq) / 2
  const cam = activeCam()
  const mx = ox + (cam.position.x / PLANE + 0.5) * sq
  const my = oy + (cam.position.z / PLANE + 0.5) * sq

  // dashed outline of the rendered (square) region — only when it differs from
  // the full image (i.e. non-square source), so the border conforms otherwise.
  if (Math.abs(w - h) > 2) {
    mmCtx.save()
    mmCtx.setLineDash([3, 3])
    mmCtx.strokeStyle = 'rgba(216,212,200,0.5)'; mmCtx.lineWidth = 1
    mmCtx.strokeRect(ox + 0.5, oy + 0.5, sq - 1, sq - 1)
    mmCtx.restore()
  }

  // camera marker + facing
  mmCtx.strokeStyle = 'rgba(255,80,60,0.95)'
  mmCtx.fillStyle = 'rgba(255,80,60,0.95)'
  mmCtx.lineWidth = 2
  mmCtx.beginPath(); mmCtx.arc(mx, my, 3.5, 0, 7); mmCtx.fill()
  if (!isoMode) {
    mmCtx.beginPath(); mmCtx.moveTo(mx, my)
    mmCtx.lineTo(mx + Math.sin(yaw) * 12, my + Math.cos(yaw) * 12); mmCtx.stroke()
  }
}
// click the minimap to enlarge it for inspection
minimap.addEventListener('click', () => minimap.classList.toggle('expanded'))

// rain (cheap point layer, toggled)
let rain = null
function makeRain() {
  const N = 1200
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    pos[i*3]   = (Math.random() - 0.5) * PLANE
    pos[i*3+1] = Math.random() * 300
    pos[i*3+2] = (Math.random() - 0.5) * PLANE
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.PointsMaterial({ color: 0xbfc6cc, size: 1.2, transparent: true, opacity: 0.5 })
  rain = new THREE.Points(g, m)
  rain.visible = false
  scene.add(rain)
}
makeRain()

// ---------------------------------------------------------------------------
// image -> heightmap. THIS is the Fontcuberta gesture: the photo becomes
// nothing but a luminance field; its meaning is discarded.
function imageToTextures(img) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  // cover-fit
  const ar = img.width / img.height
  let sw = img.width, sh = img.height, sx = 0, sy = 0
  if (ar > 1) { sw = img.height; sx = (img.width - sw) / 2 }
  else { sh = img.width; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)

  const colorTex = new THREE.CanvasTexture(c)
  colorTex.magFilter = THREE.NearestFilter
  colorTex.minFilter = THREE.NearestFilter

  // blur the heightmap slightly so terrain isn't noisy (box blur, cheap, once)
  const src = ctx.getImageData(0, 0, size, size)
  const blur = document.createElement('canvas')
  blur.width = blur.height = size
  const bctx = blur.getContext('2d')
  bctx.putImageData(src, 0, 0)
  bctx.filter = 'blur(1.5px)'
  bctx.drawImage(blur, 0, 0)
  const heightTex = new THREE.CanvasTexture(blur)
  heightTex.magFilter = THREE.NearestFilter
  heightTex.minFilter = THREE.NearestFilter

  return { colorTex, heightTex }
}

function loadImage(src) {
  const loading = document.getElementById('loading')
  loading.hidden = false
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const { colorTex, heightTex } = imageToTextures(img)
    if (uniforms.uColor.value) uniforms.uColor.value.dispose()
    if (uniforms.uHeight.value) uniforms.uHeight.value.dispose()
    uniforms.uColor.value = colorTex
    uniforms.uHeight.value = heightTex
    sourceImage = img            // keep for the minimap
    sizeMinimap()
    loading.hidden = true
    // hide the hint when the USER imports an image; on the pre-loaded default
    // world, leave it up briefly so newcomers see the controls (it's timed-out
    // separately below).
    if (!isDefaultLoad) document.getElementById('hint').style.opacity = '0'
    isDefaultLoad = false
  }
  img.onerror = () => { loading.textContent = 'could not read image'; }
  img.src = src
}
let isDefaultLoad = true
// fade the controls hint after a grace period so it's always seen on load
setTimeout(() => {
  const h = document.getElementById('hint')
  if (h) h.style.opacity = '0'
}, 8000)

// default world — your photograph, pre-loaded
loadImage('/default-source.png')

// ---------------------------------------------------------------------------
// fly controls (desktop: WASD + drag-look; touch: drag-look while dragging)
// Key by e.code (physical key) so modifiers/caps never desync the up/down
// pairing — the classic cause of a "stuck" key.
const keys = {}
// only block movement keys while typing in a genuine TEXT field; sliders,
// checkboxes, selects and buttons must NOT swallow WASD (this previously
// killed movement permanently once a control held focus).
const isTextField = () => {
  const el = document.activeElement
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && /^(text|search|email|url|password|number)$/.test(el.type)
}
addEventListener('keydown', e => { if (!isTextField()) keys[e.code] = true })
addEventListener('keyup',   e => { keys[e.code] = false })
// any focus loss or context switch clears all held keys (no lost keyup)
const clearKeys = () => { for (const k in keys) keys[k] = false }
addEventListener('blur', clearKeys)
addEventListener('contextmenu', clearKeys)
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys() })
// release focus from controls after use so they never trap the keyboard
document.querySelectorAll('input, select, button').forEach(el => {
  el.addEventListener('change', () => el.blur())
  if (el.tagName === 'BUTTON') el.addEventListener('click', () => el.blur())
})
// sliders fire 'input' continuously; blur on release (pointerup/keyup)
document.querySelectorAll('input[type="range"]').forEach(el => {
  el.addEventListener('pointerup', () => el.blur())
})

let yaw = 0, pitch = -0.15, dragging = false, dragTouch = false, px = 0, py = 0
// drag-look only when the pointer goes down ON the canvas (not on UI panels).
// Pointer capture keeps the drag alive even if the cursor crosses a panel.
canvas.addEventListener('pointerdown', e => {
  dragging = true
  dragTouch = e.pointerType === 'touch'  // only touch drags auto-walk
  px = e.clientX; py = e.clientY
  canvas.setPointerCapture?.(e.pointerId)
  e.preventDefault()
})
canvas.addEventListener('pointerup', e => { dragging = false; dragTouch = false; canvas.releasePointerCapture?.(e.pointerId) })
canvas.addEventListener('pointercancel', () => { dragging = false; dragTouch = false })
canvas.addEventListener('pointermove', e => {
  if (!dragging) return
  yaw   -= (e.clientX - px) * 0.004
  pitch -= (e.clientY - py) * 0.004
  pitch = Math.max(-1.4, Math.min(1.4, pitch))
  px = e.clientX; py = e.clientY
})

// scroll wheel: focal length in perspective, ortho span in iso (correct
// zoom paradigm for each — ortho has no FOV so it scales the frustum).
canvas.addEventListener('wheel', e => {
  e.preventDefault()
  if (isoMode) {
    isoZoom = THREE.MathUtils.clamp(isoZoom * (e.deltaY > 0 ? 1.08 : 0.926), 0.18, 1.4)
    frameOrtho()
  } else {
    const el = $('focal')
    const step = e.deltaY > 0 ? -4 : 4
    el.value = THREE.MathUtils.clamp(parseInt(el.value) + step, +el.min, +el.max)
    el.dispatchEvent(new Event('input'))
  }
}, { passive: false })

let driftAngle = 0
function updateCamera(dt) {
  // cinematic drift: slow orbit around the terrain centre, hands-off
  if (drift) {
    driftAngle += dt * 0.06
    const r = 300
    camera.position.set(Math.cos(driftAngle) * r, 130 + Math.sin(driftAngle * 0.5) * 40, Math.sin(driftAngle) * r)
    camera.lookAt(0, 30, 0)
    return
  }

  const dir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  )
  const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw))
  const boost = (keys['ShiftLeft'] || keys['ShiftRight']) ? 3 : 1
  const speed = 120 * boost * dt
  const move = new THREE.Vector3()
  // on touch, walk forward only while dragging (so you can stop and look)
  if (keys['KeyW'] || keys['ArrowUp'] || dragTouch) move.add(dir)
  if (keys['KeyS'] || keys['ArrowDown']) move.sub(dir)
  if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right)
  if (keys['KeyD'] || keys['ArrowRight']) move.add(right)
  if (keys['KeyQ']) move.y -= 1
  if (keys['KeyE']) move.y += 1
  if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed)
  camera.position.y = Math.max(camera.position.y, 12) // don't fall through
  camera.lookAt(camera.position.clone().add(dir))
}

// ---------------------------------------------------------------------------
// UI bindings
const $ = id => document.getElementById(id)
const setReadout = (id, txt) => { const el = $(id); if (el) el.textContent = txt }

// fog-driven draw distance: denser fog pulls the far clip in, so we literally
// render less terrain in heavy fog — the fog IS the perf lever (your principle).
function applyFogToDrawDistance() {
  const d = uniforms.uFogDensity.value
  camera.far = THREE.MathUtils.clamp(2600 / (0.4 + d * 1.6), 700, 4000)
  camera.updateProjectionMatrix()
}

// fog: maps slider -> density. exponential-squared in the shader.
$('fog').oninput   = e => { uniforms.uFogDensity.value = e.target.value / 100 * 1.4; setReadout('v-fog', e.target.value); applyFogToDrawDistance() }
$('water').oninput = e => { uniforms.uWaterLevel.value = e.target.value / 100; setReadout('v-water', e.target.value); updateWaterLevel() }
// relief: vertical exaggeration, 0 (flat) -> 11 (alpine)
$('relief').oninput= e => {
  const v = (e.target.value / 100) * 11
  uniforms.uRelief.value = v
  setReadout('v-relief', v.toFixed(1))
  updateWaterLevel()
}
$('style').onchange = e => {
  const scan = e.target.value === 'scan'
  uniforms.uScan.value = scan ? 1 : 0
  water.visible = !scan                 // water plane would break the scan look
  sky.visible = !scan                   // scan floats over black space
  scene.background = scan ? new THREE.Color(0x000308) : uniforms.uFogColor.value
}
let weatherMode = 'fog', rainSpeed = 240
$('weather').onchange = e => {
  const w = e.target.value
  weatherMode = w
  const precip = w === 'rain' || w === 'snow' || w === 'storm'
  rain.visible = precip
  // snow drifts white & slow; rain/storm streak grey & fast
  const snowy = w === 'snow'
  rain.material.color.setHex(snowy ? 0xeef2f6 : 0xbfc6cc)
  rain.material.size = snowy ? 2.2 : 1.2
  rainSpeed = snowy ? 60 : 240
  const dens = { clear: 0.12, fog: 0.42, rain: 0.85, snow: 0.6, storm: 1.0 }[w]
  uniforms.uFogDensity.value = dens
  $('fog').value = dens / 1.4 * 100
  setReadout('v-fog', Math.round($('fog').value))
  applyFogToDrawDistance()
}

// time of day: drives sun direction, sun colour, and fog colour together.
// 0 = night, 0.5 = noon, 1 = night again — passing through dawn & dusk.
const DAWN  = new THREE.Color(0xffb27a), NOON = new THREE.Color(0xfff4e0)
const DUSK  = new THREE.Color(0xff8a5c), NIGHT = new THREE.Color(0x3a4a6a)
const FOG_DAY = new THREE.Color(0x9aa0a4), FOG_NIGHT = new THREE.Color(0x10141f)
const FOG_GOLD = new THREE.Color(0xb89a86)
let todT = 0.42, biomeIdx = 0, nightFactor = 0
function setTimeOfDay(t01) {
  todT = t01
  // sun arcs from east (t=0) overhead (0.5) to west (1)
  const a = t01 * Math.PI                 // 0..pi
  const elev = Math.sin(a)                // 0 at horizons, 1 at noon
  uniforms.uLightDir.value.set(Math.cos(a) * 0.8, Math.max(elev, 0.08), 0.25).normalize()

  let sun, fog
  if (t01 < 0.18)      { const k = t01 / 0.18;        sun = NIGHT.clone().lerp(DAWN, k); fog = FOG_NIGHT.clone().lerp(FOG_GOLD, k) }
  else if (t01 < 0.5)  { const k = (t01 - 0.18)/0.32; sun = DAWN.clone().lerp(NOON, k);  fog = FOG_GOLD.clone().lerp(FOG_DAY, k) }
  else if (t01 < 0.82) { const k = (t01 - 0.5)/0.32;  sun = NOON.clone().lerp(DUSK, k);  fog = FOG_DAY.clone().lerp(FOG_GOLD, k) }
  else                 { const k = (t01 - 0.82)/0.18; sun = DUSK.clone().lerp(NIGHT, k); fog = FOG_GOLD.clone().lerp(FOG_NIGHT, k) }

  // dim the sun at the extremes (night)
  const dim = 0.35 + 0.65 * Math.max(elev, 0.0)
  uniforms.uSunColor.value.copy(sun).multiplyScalar(dim)
  uniforms.uFogColor.value.copy(fog)
  if (uniforms.uScan.value < 0.5) scene.background.copy(fog)

  // night factor: 1 near t=0/1, 0 at noon — drives moon + stars + sky dimming
  nightFactor = 1.0 - Math.min(elev / 0.5, 1.0)
  skyUniforms.uNight.value = nightFactor
  uniforms.uNight.value = nightFactor
  applyBiomeSky(biomeIdx) // re-evaluate sky tint for this time of day
}
$('tod').oninput = e => setTimeOfDay(e.target.value / 100)

$('biome').onchange = e => {
  biomeIdx = { alpine:0, desert:1, tundra:2, volcanic:3, verdant:4,
               coral:5, saltflat:6, lunar:7, megastructure:8, toxic:9 }[e.target.value]
  uniforms.uBiome.value = biomeIdx
  applyBiomeSky(biomeIdx)
  waterUniforms.uWaterColor.value.setHex(WATER_BIOMES[biomeIdx])
  skyUniforms.uEarth.value = biomeIdx === 7 ? 1 : 0   // lunar: hang the Earth
}

// advanced
$('curve').onchange = e => { uniforms.uReliefCurve.value = parseInt(e.target.value) }
$('detail').oninput = e => { uniforms.uDetail.value = e.target.value / 100; setReadout('v-detail', e.target.value) }
$('haze').oninput   = e => { uniforms.uHaze.value = e.target.value / 100; setReadout('v-haze', e.target.value) }
$('eco').oninput    = e => { uniforms.uEco.value = e.target.value / 100; setReadout('v-eco', e.target.value) }
$('glitch').oninput = e => { uniforms.uGlitch.value = e.target.value / 100 * 0.5; setReadout('v-glitch', e.target.value) }
$('snow').oninput = e => { uniforms.uSnowLine.value = e.target.value / 100; setReadout('v-snow', e.target.value) }
$('snap').oninput = e => { uniforms.uSnap.value = e.target.value / 100; setReadout('v-snap', e.target.value) }
$('res').oninput  = e => { lowresScale = e.target.value / 100; setReadout('v-res', e.target.value + '%'); resize() }
$('tint').onchange= e => { uniforms.uTint.value = e.target.checked ? 0.16 : 0.0 }

// capture resolution: supersample factor applied only during capture
$('cap').oninput = e => { captureScale = e.target.value / 100; setReadout('v-cap', e.target.value + '%') }

// tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab))
    document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab })
  }
})

// hide UI (button + H hotkey) — also handy for clean captures
let uiHidden = false
function toggleUI(force) {
  uiHidden = force !== undefined ? force : !uiHidden
  document.getElementById('ui').classList.toggle('ui-hidden', uiHidden)
  $('hideui').textContent = uiHidden ? 'show ui' : 'hide ui'
}
$('hideui').onclick = () => toggleUI()
addEventListener('keydown', e => {
  if (e.code === 'KeyH' && !isTextField()) toggleUI()
})

// camera: focal length (mm, 35mm-equivalent). vertical FOV from a 24mm sensor.
function focalToFov(mm) { return 2 * Math.atan(24 / (2 * mm)) * 180 / Math.PI }
$('focal').oninput = e => {
  const mm = parseInt(e.target.value)
  if (isoMode) {
    // in ortho, the same slider drives zoom (span): 14mm->wide, 180mm->tight
    const t = (mm - e.target.min) / (e.target.max - e.target.min)
    isoZoom = THREE.MathUtils.lerp(1.4, 0.18, t)
    frameOrtho()
    setReadout('v-focal', Math.round(t * 100) + '%')
  } else {
    camera.fov = focalToFov(mm)
    camera.updateProjectionMatrix()
    setReadout('v-focal', mm + 'mm')
  }
}

// depth of field: applied only on capture (free — real-time would cost frames)
let dofOnCapture = false
$('dof').onchange = e => { dofOnCapture = e.target.checked }

// isometric / orthographic view
$('iso').onchange = e => {
  isoMode = e.target.checked
  frameOrtho()
  // the focal slider becomes a zoom control in orthographic view
  $('focal-label').textContent = isoMode ? 'zoom' : 'focal length'
  $('focal').dispatchEvent(new Event('input')) // refresh readout for the new mode
}

// minimap + export options
$('mm').onchange = e => { minimap.hidden = !e.target.checked }
let mmInExport = true, watermark = false
$('mmExport').onchange = e => { mmInExport = e.target.checked }
$('wm').onchange = e => { watermark = e.target.checked }

// cinematic drift: hands-off slow orbit
let drift = false
$('drift').onchange = e => { drift = e.target.checked }

// randomise: scramble every parameter into a fresh world
function randomise() {
  const r = () => Math.random()
  const set = (id, val) => { const el = $(id); el.value = val; el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input')) }
  set('relief', 30 + r() * 60)
  set('water', r() * 55)
  set('fog', 10 + r() * 30)
  set('tod', r() * 100)
  set('detail', 30 + r() * 60)
  set('haze', r() * 100)
  set('eco', r() * 100)
  set('snow', 50 + r() * 45)
  // discrete pickers
  const biomes = ['alpine','desert','tundra','volcanic','verdant']
  const bs = $('biome'); bs.value = biomes[Math.floor(r() * biomes.length)]; bs.dispatchEvent(new Event('change'))
  const cv = $('curve'); cv.value = String(Math.floor(r() * 4)); cv.dispatchEvent(new Event('change'))
  const ws = $('weather'); ws.value = ['clear','fog','rain'][Math.floor(r() * 3)]; ws.dispatchEvent(new Event('change'))
}
$('random').onclick = randomise

// collapsible panels
$('dock-toggle').onclick = () => $('panel').classList.toggle('collapsed')
$('adv-toggle').onclick = () => {
  const body = $('adv-body')
  body.hidden = !body.hidden
  $('adv-toggle').classList.toggle('open', !body.hidden)
}

// about infobox
$('about-toggle').onclick = () => { $('about').hidden = !$('about').hidden }
// about/controls sub-tabs
document.querySelectorAll('.atab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.atab').forEach(x => x.classList.toggle('active', x === t))
    document.querySelectorAll('.atab-panel').forEach(p => { p.hidden = p.dataset.apanel !== t.dataset.atab })
  }
})

// --- permalink: encode every control into the URL hash, restore on load ---
// (the imported image can't fit in a URL, so a shared link restores all the
//  parameters over the default world — note shown on copy.)
const SHARE_IDS = ['relief','water','fog','tod','biome','weather','curve','detail',
  'haze','eco','glitch','snow','snap','res','focal','tint','dof','iso','mm']
function serialiseState() {
  const parts = SHARE_IDS.map(id => {
    const el = $(id)
    const v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value
    return encodeURIComponent(v)
  })
  return parts.join(',')
}
function applyState(str) {
  const vals = str.split(',')
  SHARE_IDS.forEach((id, i) => {
    if (i >= vals.length) return
    const el = $(id), v = decodeURIComponent(vals[i])
    if (el.type === 'checkbox') { el.checked = v === '1'; el.dispatchEvent(new Event('change')) }
    else { el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')) }
  })
}
$('share').onclick = async () => {
  const url = location.origin + location.pathname + '#' + serialiseState()
  try { await navigator.clipboard.writeText(url) } catch (_) {}
  const b = $('share'); const t = b.textContent
  b.textContent = 'link copied ✓'
  setTimeout(() => { b.textContent = t }, 1400)
}

// initialise readouts + derived state from starting slider values
;['fog','water','relief','detail','haze','eco','glitch','snow','snap','focal','cap'].forEach(id => $(id).dispatchEvent(new Event('input')))
setReadout('v-res', $('res').value + '%')
setTimeOfDay($('tod').value / 100)

// minimap visible by default (checkbox starts checked)
minimap.hidden = !$('mm').checked

// restore shared state from URL hash, if present
if (location.hash.length > 1) {
  try { applyState(location.hash.slice(1)) } catch (_) {}
}

// file / drag-drop + dedicated import button
$('file').onchange = e => { const f = e.target.files[0]; if (f) loadImage(URL.createObjectURL(f)) }
$('import').onclick = () => $('file').click()
$('hint').onclick = () => $('file').click()
addEventListener('dragover', e => e.preventDefault())
addEventListener('drop', e => {
  e.preventDefault()
  const f = e.dataTransfer.files[0]
  if (f && f.type.startsWith('image/')) loadImage(URL.createObjectURL(f))
})

// screenshot: bump to full-res for one frame, capture, drop back.
// DoF (if enabled) is applied here only — a still can afford a real blur.
$('shot').onclick = () => {
  capturing = true
  resize()
  renderer.render(scene, activeCam())

  // base frame (sharp or DoF'd) — both are canvases, drawable immediately
  const frame = dofOnCapture ? applyDepthOfField(renderer.domElement) : renderer.domElement

  // composite onto an output canvas so we can stamp minimap + watermark
  const w = renderer.domElement.width, h = renderer.domElement.height
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const ctx = out.getContext('2d')
  ctx.drawImage(frame, 0, 0, w, h)

  if (mmInExport && sourceImage) {
    drawMinimap()
    const m = Math.round(h * 0.16), pad = Math.round(h * 0.02)
    ctx.globalAlpha = 0.85
    ctx.drawImage(minimap, w - m - pad, h - m - pad, m, m)
    ctx.globalAlpha = 1
  }
  if (watermark) {
    const x = Math.round(h * 0.025), pad = Math.round(h * 0.025)
    const big = Math.round(h * 0.042), small = Math.round(h * 0.016)
    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = Math.round(h * 0.01)
    // subtitle line (drawn first, sits at the very bottom)
    ctx.font = `${small}px "Courier New", monospace`
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText('ANABASIS.SUBSURFACES.NET', x, h - pad)
    // wordmark above it
    ctx.font = `bold ${big}px "Courier New", monospace`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.save()
    ctx.translate(0, 0)
    ctx.fillText('A N A B A S I S', x, h - pad - small - Math.round(h * 0.008))
    ctx.restore()
    ctx.shadowBlur = 0
  }

  const a = document.createElement('a')
  a.href = out.toDataURL('image/png')
  a.download = `anabasis-${Date.now()}.png`
  a.click()

  capturing = false
  resize()
  const flash = document.createElement('div')
  flash.className = 'flash fire'
  document.body.appendChild(flash)
  setTimeout(() => flash.remove(), 400)
}

// fake large-aperture DoF for stills: sharp focal band across the middle,
// foreground and sky/horizon fall soft. Composited on a 2D canvas — no
// runtime cost, only runs on capture.
function applyDepthOfField(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const ctx = out.getContext('2d')

  // 1) blurred layer
  ctx.filter = `blur(${Math.max(2, Math.round(h * 0.012))}px)`
  ctx.drawImage(srcCanvas, 0, 0)
  ctx.filter = 'none'

  // 2) sharp focal band, feathered at top (sky) and bottom (foreground)
  const band = document.createElement('canvas')
  band.width = w; band.height = h
  const bctx = band.getContext('2d')
  bctx.drawImage(srcCanvas, 0, 0)
  const grad = bctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0.00, 'rgba(0,0,0,0)')   // sky: soft
  grad.addColorStop(0.42, 'rgba(0,0,0,1)')   // focal plane: sharp
  grad.addColorStop(0.62, 'rgba(0,0,0,1)')
  grad.addColorStop(1.00, 'rgba(0,0,0,0)')   // foreground: soft
  bctx.globalCompositeOperation = 'destination-in'
  bctx.fillStyle = grad
  bctx.fillRect(0, 0, w, h)

  ctx.drawImage(band, 0, 0)
  return out // a canvas, ready to composite synchronously
}

// ---------------------------------------------------------------------------
// resize honours the low-res lever (and the capture supersample factor)
function resize() {
  const scale = capturing ? captureScale : (lowres ? lowresScale : 1)
  const w = Math.floor(innerWidth * scale)
  const h = Math.floor(innerHeight * scale)
  renderer.setSize(w, h, false)
  canvas.style.width = innerWidth + 'px'
  canvas.style.height = innerHeight + 'px'
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  frameOrtho()
  uniforms.uResolution.value.set(w, h)
}
addEventListener('resize', resize)
resize()

// ---------------------------------------------------------------------------
// loop
let lightning = 0          // decaying flash brightness for storm
let lightningTimer = 1.5
const _fogBase = new THREE.Color()
const clock = new THREE.Clock()
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  uniforms.uTime.value += dt
  if (!isoMode) updateCamera(dt)

  if (rain.visible) {
    const drift = weatherMode === 'snow' ? 18 : 0
    const p = rain.geometry.attributes.position
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - rainSpeed * dt
      if (drift) p.setX(i, p.getX(i) + Math.sin(uniforms.uTime.value + i) * drift * dt)
      if (y < 0) y = 300
      p.setY(i, y)
    }
    p.needsUpdate = true
  }

  // storm: occasional lightning that briefly whitens the fog/sky
  if (weatherMode === 'storm') {
    lightningTimer -= dt
    if (lightningTimer <= 0) { lightning = 1; lightningTimer = 2 + Math.sin(uniforms.uTime.value) + 2 }
    if (lightning > 0) {
      lightning = Math.max(0, lightning - dt * 3)
      _fogBase.copy(uniforms.uFogColor.value)
      const flashAmt = lightning * lightning * 0.8
      uniforms.uFogColor.value.lerp(new THREE.Color(0xdfe6ef), flashAmt)
      if (sky.visible) scene.background.copy(uniforms.uFogColor.value)
      renderer.render(scene, activeCam())
      uniforms.uFogColor.value.copy(_fogBase)        // restore so it doesn't accumulate
      if (sky.visible && uniforms.uScan.value < 0.5) scene.background.copy(_fogBase)
      if (!minimap.hidden) drawMinimap()
      requestAnimationFrame(tick)
      return
    }
  }

  renderer.render(scene, activeCam())
  if (!minimap.hidden) drawMinimap()
  requestAnimationFrame(tick)
}
tick()
