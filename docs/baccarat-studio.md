# Baccarat studio

The existing `/baccarat` route now uses the dealer and black/gold table from the supplied `Screen Recording 2026-10-17 024452.mp4`. The media is cropped at native resolution, not generated or advertised as 4K. Original screen controls, countdowns and dealt card faces are excluded or composited away. The recording's audio is removed; the table has its own music, effects and Hindi commentary.

The server remains authoritative for the shoe, Punto Banco third-card rules, bets, wallet settlement and verification. The five existing markets (Player, Banker, Tie, Player Pair, Banker Pair) and configured payout returns are preserved. The reference's bonus, either-pair and suited-pair markets have not been added to the server. No decorative betting buttons simulate unsupported bets.

`studioTimeline.ts` orders P1, B1, P2, B2 and only the third cards present in the actual result. Individual delivery takes are reused for optional third cards. A synchronized video matte puts fingers in front of the rendered cards. Scores and result highlights wait for the physical release, including when joining an ongoing round. Reduced-motion mode freezes the dealer and continues the authoritative score presentation. If the video, clean plate or WebGL fails, the score panel continues without exposing uncomposited recorded results.

New server rounds reserve at least 12 seconds for dealing. Existing rounds retain their snapshotted timing. Draft chips auto-submit through the existing timed-bet path; accepted chips remain visible. Undo, clear, repeat and double apply to the draft. Balance and table limits are checked before staging and submitting, with server validation still final.

The dealer and betting console share one viewport grid. The camera fits the available scene height so the dealt cards stay above the centered bet board. Coins, settings and actions remain grouped; phones stack the wallet and two history grids underneath. Baccarat scopes its bet and coin dimensions to avoid the generic controls stylesheet shrinking the table targets. The browser fixture includes the application's shared controls, viewport, layout and mobile styles, with alignment checks from 320px phones through 1920px desktops and phone landscape.

## Development and verification

From the repository root:

```powershell
node artifacts/3d-game/node_modules/vite/bin/vite.js --config artifacts/3d-game/vite.baccarat-studio.config.ts
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.baccarat-studio.config.ts
node artifacts/3d-game/node_modules/vite/bin/vite.js build --config artifacts/3d-game/vite.baccarat-studio.config.ts
node node_modules/typescript/bin/tsc -p artifacts/3d-game/tsconfig.json --noEmit
```

The isolated development entry runs at `http://127.0.0.1:5386/baccarat` and connects to the existing API on port 5200. It requires normal authentication. Only the browser tests mock accounts and outcomes. The normal application route remains `/baccarat`.

Production must include `public/media/baccarat/` (approximately 10.4 MB, including 0.78 MB of audio). The isolated verification build deliberately does not copy the project's whole public folder. The regular application build includes these public assets.

After deployment, run `node artifacts/3d-game/scripts/check-studio-deployment.mjs http://localhost:5200`. It verifies media types and file sizes, video byte ranges, and missing-media errors. When packaging a build with `copyPublicDir: false`, include the complete public runtime assets separately; copying only the audio directory leaves the dealer scene unavailable.

To regenerate the media, set `FFMPEG` to an installed FFmpeg executable, then run:

```powershell
node artifacts/3d-game/scripts/prepare-baccarat-studio.mjs "C:\Users\hacker\Videos\Screen Recordings\Screen Recording 2026-10-17 024452.mp4"
```

Media provenance is recorded in `public/media/baccarat/provenance.json`. Browser screenshots are written to `tmp/baccarat-reference/`.

## Table audio

The speaker button opens music, Hindi commentary and volume controls. Sound/master/effects/music preferences use the existing persisted game settings; commentary and its volume are stored under `baccarat:commentary` and `baccarat:voice-volume`. Audio attempts to start automatically when the game opens. If the browser blocks it, the first normal tap or key press retries; no bet or separate sound-button press is required. A visible "Tap for sound" button is also available. Saved mute is respected.

The original 28-second electric-piano, bass and brush loop is scoped to Baccarat, replacing its generic background loop. Music drops to 24% of its selected level during speech. The 31 bundled Hindi female voice clips cover betting open, the final five seconds, betting closed, all Player/Banker totals, Player/Banker/Tie results, naturals and pairs. These are locally generated stock Kokoro `hf_alpha` speech, not the filmed dealer's voice or a lip-synchronized performance. No speech service or browser TTS is needed during play. Scripts, generation settings and provenance accompany the audio files.

Only the dealer's presented-card count can release score/result commentary. Results use the server's totals and winner; a late join uses the current result, never a backlog. Speech has one cancellable lane. Muting commentary, hiding the tab, leaving the page, disabling the table or starting a new round cancels pending speech. Missing clips fail silently without affecting game state. Music pauses when the tab is hidden and on exit. Existing CC0 Kenney card/chip recordings supply physical effects, synchronized with individual card releases and successful bet edits; final-five-second ticks use the existing effects bus.

To regenerate with the cached Python 3.11 environment/model, run `scripts/prepare-baccarat-audio.py` from the game package (or its full path from the root). It uses `.cache/sports-commentary/packages`, `kokoro-v1.0.onnx`, `voices-v1.0.bin`, and the local FFmpeg tool, overridable with `FFMPEG`. Runtime assets are ordinary MP3 files in `public/media/baccarat/audio/`; the Python environment is only needed for regeneration.

The Baccarat browser suite covers real music playback/ducking, commentary sequence and reveal gating, persistent controls, mute/visibility/unmount cleanup, late natural/tie results and failed audio requests, alongside the existing dealing, betting and responsive-layout checks.
