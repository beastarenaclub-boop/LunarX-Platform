# APEX Superbike Racing

A complete local single-player browser racing game, inspired by the supplied
superbike reference image. The linked YouTube video could not be retrieved;
it is not used as footage or an embedded background. Everything on the circuit
renders interactively in Three.js. This is an assisted arcade simulation, not a
commercial-grade vehicle dynamics simulator or a photorealistic AAA game.

## Play the ready-built package

Install Node.js 22 or newer. In the exported package, double-click
`START-GAME.cmd` on Windows, or run `node server.mjs`. Open
http://localhost:5193 and keep the server window running while playing.
The package includes the compiled game and all fonts/models/textures; no npm
install, database, account, paid API or internet connection is needed to play.
Use a browser with WebGL 2 and hardware acceleration. Mobile controls work in
portrait and landscape; Performance quality reduces shadow/rendering cost.

## Play from this repository

Double-click `START-BIKE-GAME.cmd`, or run:

```sh
npm run bike:build
npm run bike:start
```

For development, use `npm run bike:dev`. Both servers use port 5193; run one at
a time. This standalone game does not alter existing casino or lottery routes.

## What's included

- Three bike configurations (RR 1000, V4 Corsa, RS 765), selectable liveries,
  distinct acceleration, top-speed limits and steering response.
- A 1.70 km closed Riviera circuit, 13 spline sections, kerbs, track markings,
  guardrails, fences, pit building, grandstand, trees and hills.
- Circuit race against five AI riders, time attack, and unlimited free ride.
- One, three or five laps; Rookie, Sport and Pro opponents.
- Speed-dependent lean, acceleration/drag, braking, grip loss when cornering
  too quickly, run-off slowdown, barrier and opponent contacts, track recovery.
- Track-following assistance enabled by default. Turning it off requires
  steering through each corner. Brake before sharp turns to avoid running wide.
- Chase, cockpit and trackside cameras; speed, gear, RPM, positions, minimap,
  live lap timing, countdown, pause/restart and finish results.
- Synthesized engine/wind/start audio. Sound starts after a user gesture.
- Keyboard and simultaneous touch controls, fullscreen, quality settings,
  local settings and ten fastest completed-session laps.

| Input | Action |
| --- | --- |
| W / Up | Throttle |
| S / Down / Space | Brake |
| A D / Left Right | Steer and lean |
| C | Cycle camera |
| R | Recover to the centre of the track |
| P / Escape | Pause / resume |
| M | Toggle sound |

Switching browser tabs pauses the session and releases inputs. On touch devices,
hold GAS/BRAKE and the steering buttons. Best laps and settings use localStorage;
private browsing or clearing site data can remove them. Free-ride laps appear
in the current session; the saved leaderboard records completed races/time attacks.

## Build, checks and packaging

```sh
npm run bike:check
npm run bike:test
npm run bike:build
npm run bike:package
```

Tests cover circuit continuity, countdown, acceleration/braking, steering,
run-off/barriers/recovery, pause, AI finishes, one/three lap results, restarting,
unlimited free ride, desktop interactions, saved settings and mobile touch/layout.
Browser tests use installed Google Chrome and start their own Vite server.
Screenshots are written to `tmp/bike-validation/`.

The exported `source/` is a standalone Vite/React/TypeScript project. Run
`npm install` and `npm run dev` there to edit it. `npm run build` produces a new
`dist/`; copy its contents into the package's `site/` folder to update the
ready-built game. The asset authoring script depends on the original workspace's
CC0 human source file and Blender; neither is needed to play or build the app.

## Scope and asset provenance

This release is single-player and local. Opponents are computer-controlled;
records are per-browser, not a shared multiplayer leaderboard. No backend or
real-money system is included. Bike/rider contacts slow the bike; this release
does not have ragdoll crashes, damage, wheelies or a career campaign.

Motorcycles are original procedural meshes sharing a base shape. The fitted rider
derives from the existing CC0 Vitruvian/CharMorph human. Trees use crossed cards
rendered from the CC0 Poly Haven tree, and the grandstand uses existing generated
crowd artwork. See `site/CREDITS.txt` in the package (or the app's
`public/CREDITS.txt`) and the bundled third-party/font licenses.
