# Optimized roulette model

The shipped asset is derived from the supplied FBX archive. The original
archive and source-resolution JPEGs are intentionally not included in the app.

- `roulette-wheel-v2.glb`: browser-ready geometry from the latest supplied GLB,
  about 5 MB, with embedded source materials. The runtime still applies the
  optimized WebP maps below when the matching material names are available.
- `roulette-wheel.usdz`: the supplied Apple AR version. It is offered through
  the roulette header for Safari AR Quick Look and downloads on unsupported
  browsers; it is not used as the web renderer.
- Six 768 px WebP base-colour/normal maps: about 170 KB total.
- Useful material parts are `inside` (rotating pocket rotor), `outside`
  (stationary bowl), and `turret` (stationary centre).

## Pocket calibration

The `inside` UV map contains the authoritative clockwise European order. Pocket
zero is texture-top and maps to model-local `-X`; the rendered top pointer looks
toward model-local `-Z`. Therefore the model rotor uses a fixed `-90deg` zero
offset in addition to the logical wheel rotation. Keep this calibration and the
all-37-pocket test in sync if the model is re-exported.