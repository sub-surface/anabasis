# ANABASIS

*A march inland from the image.*

Feed the machine a photograph and it forgets the photograph. What survives is only
the brightness of each pixel, which the renderer reads as elevation — and from that
it hallucinates the one kind of world it knows how to make: a terrain, fogged and
memoryless, that was never anywhere.

A real-time, PS1/PS2-era topographic apparatus, after Joan Fontcuberta's *Orogenesis*
(2002–2006). Built with Three.js, deployed as a Cloudflare Worker.

Live: **[anabasis.subsurfaces.net](https://anabasis.subsurfaces.net)**

## How it works

Any image becomes a luminance heightfield. A custom GLSL shader displaces a low-poly
grid by that height and shades it in the deliberately limited vocabulary of 90s console
hardware — every retro artifact is the *cheap* path, not a cost:

- low-res framebuffer upscaled with nearest-neighbour
- view-space vertex snapping (the PS1 "wobble")
- per-vertex (Gouraud) lighting, posterised + Bayer-dithered colour
- exponential (Silent Hill) fog that doubles as the draw-distance / performance lever

On top: Terragen-style altitude+slope snow/rock with fuzzy zones, world-anchored FBM
surface grain, aerial haze, image-driven ecology, per-biome shorelines, a low-poly
water surface, a gradient skybox with sun/moon/stars, and ten biomes including
sci-fi modes (megastructure, toxic) plus a holographic wireframe-scan render style.

## Controls

- **WASD / arrows** move · **drag** look · **Q/E** down/up · **Shift** boost
- **scroll** zoom (focal length, or ortho span in isometric)
- **H** hide the interface
- **World** tab: relief, water, fog, time of day, biome, weather, render style, + advanced
- **Capture** tab: focal length, resolution, depth of field, isometric, minimap, watermark

## Develop

```bash
npm install
npm run dev       # vite dev server
npm run build     # → dist/
npm run deploy    # build + wrangler deploy
```

After [Joan Fontcuberta](https://www.artsy.net/show/photo-edition-berlin-joan-fontcuberta-orogenesis-landscapes-without-memory).
Named for [Xenophon's *Anabasis*](https://en.wikipedia.org/wiki/Anabasis_(Xenophon)).
