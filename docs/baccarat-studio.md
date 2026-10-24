# Baccarat studio

The existing `/baccarat` route now uses the dealer and black/gold table from the supplied `Screen Recording 2026-10-17 024452.mp4`. The media is cropped at native resolution, not generated or advertised as 4K. Original screen controls, countdowns and dealt card faces are excluded or composited away. The recording's audio is removed; the table has its own music and effects. Spoken commentary is disabled.

The server remains authoritative for the shoe, Punto Banco third-card rules, bets, wallet settlement and verification. New rounds use payout version 3, matching the two supplied `WhatsApp Image 2026-10-21 at 7.33.57 PM` rules images. Player and Banker pay 1:1 profit, except a Banker win totaling 6 pays 0.5:1 (₹100 returns ₹150 including stake). Tie pays 8:1 and both pairs pay 11:1. Pairs match the ranks of the first two cards only. Five winning-score markets also accept bets: Score 1–4 (7.5:1 profit), 5–6 (4:1), 7 (4.5:1), 8 (3:1) and 9 (2.5:1). Winning stakes are returned in addition to profit, subject to the table's payout cap. Banker 6 does not reduce pair or score winnings. These are fixed reference prices, not 85% RTP-adjusted returns. The score is the winning hand's final total after all drawn cards, not the winning margin; every score bet loses on a tie, including 0–0. Main Player/Banker bets push on ties. Up to ten distinct markets can be submitted in one slip. Version 1 and 2 histories and in-flight rounds retain their original prices and remain verifiable; the UI quotes the active round's snapshot. The reference's bonus, either-pair and suited-pair markets have not been added to the server.

`studioTimeline.ts` orders P1, B1, P2, B2 and only the third cards present in the actual result. Individual delivery takes are reused for optional third cards. A synchronized video matte puts fingers in front of the rendered cards. Scores and result highlights wait for the physical release, including when joining an ongoing round. Reduced-motion mode freezes the dealer and continues the authoritative score presentation. If the video, clean plate or WebGL fails, the score panel continues without exposing uncomposited recorded results.

New server rounds allow 20 seconds for betting, followed by 8 seconds dealing and 2 seconds showing the result: 30 seconds in total. The shared `BACCARAT_ROUND_TIMING` applies to both server snapshots and the client fallback; six-card video sequences speed up to fit the reveal window. Existing rounds retain their snapshotted timing. Generic admin timing fields are read-only for Baccarat. Draft chips auto-submit through the existing timed-bet path; accepted chips remain visible. Undo, clear, repeat and double apply to the draft. Balance and table limits are checked before staging and submitting, with server validation still final.

The interface follows the supplied `WhatsApp Video 2026-10-19 at 5.02.18 PM.mp4`: a grey page, existing Crypto777 logo and balance header, green round-status strip, purple video surround, rectangular denomination strip, blue Player/red Banker panels and a green circular Tie target. The user explicitly chose to retain the existing dealer video. The cards sit inside the betting panels with totals and winner highlights; the Tie target does not cover them. Locked denomination controls and bet targets show padlocks. Help, rules and fairness controls lead to the existing application features. `baccarat-reference.css` supplies this presentation without changing shared games or the synchronized dealer renderer.

The screenshot's five grey score boxes sit directly below the dealer, above the denomination controls. They use the same chip selection, undo, clear, double, automatic submission, accepted stacks and repeat controls as other markets. Rates come from the API; score buttons stay unavailable if the running server does not yet publish them. Lock icons follow betting availability. Winning-score highlights wait for the full card presentation and reset for the next round.

The camera fits the available scene height so all dealt cards remain visible. Baccarat scopes its bet and denomination dimensions to avoid the generic controls stylesheet shrinking the table targets. The browser fixture includes the application's shared controls, viewport, layout and mobile styles, with checks from 320px phones through 1920px desktops and phone landscape. Short screens scroll to statistics and the footer.

## Development and verification

From the repository root:

```powershell
node artifacts/3d-game/node_modules/vite/bin/vite.js --config artifacts/3d-game/vite.baccarat-studio.config.ts
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.baccarat-studio.config.ts
node artifacts/3d-game/node_modules/vite/bin/vite.js build --config artifacts/3d-game/vite.baccarat-studio.config.ts
node node_modules/typescript/bin/tsc -p artifacts/3d-game/tsconfig.json --noEmit
```

The isolated development entry runs at `http://127.0.0.1:5386/baccarat` and connects to the existing API on port 5200. It requires normal authentication. Only the browser tests mock accounts and outcomes. The normal application route remains `/baccarat`.

The B2C development page at `http://localhost:5180/baccarat` also proxies to the API on port 5200. With Docker Compose, changing source files or passing the isolated tests does not update the running API image. Rebuild with `docker compose build api`, then apply it with `docker compose up -d --no-deps api`. Check `/api/game/config/baccarat/public` through the same frontend URL: its betting, reveal and settle durations must be `20000`, `8000` and `2000`. Verify a fresh round as well, since an older in-flight round retains its original deadlines.

Production must include `public/media/baccarat/` (approximately 10.4 MB, including 0.78 MB of audio). The isolated verification build deliberately does not copy the project's whole public folder. The regular application build includes these public assets.

After deployment, run `node artifacts/3d-game/scripts/check-studio-deployment.mjs http://localhost:5200`. It verifies media types and file sizes, video byte ranges, and missing-media errors. When packaging a build with `copyPublicDir: false`, include the complete public runtime assets separately; copying only the audio directory leaves the dealer scene unavailable.

To regenerate the media, set `FFMPEG` to an installed FFmpeg executable, then run:

```powershell
node artifacts/3d-game/scripts/prepare-baccarat-studio.mjs "C:\Users\hacker\Videos\Screen Recordings\Screen Recording 2026-10-17 024452.mp4"
```

Media provenance is recorded in `public/media/baccarat/provenance.json`. Browser screenshots are written to `tmp/baccarat-reference/`.

## Table audio and results

The speaker button opens music, sound effects and volume controls. Spoken commentary and its controls have been removed from the Baccarat runtime; old `baccarat:commentary` preferences cannot re-enable it. Commentary recordings are not fetched or played. The shared opening/closing voice callbacks remain disabled. The dealer recording itself remains muted.

The lounge loop and card/chip effects still use the existing persisted game settings. Audio attempts to start when the table opens, with the first normal interaction retrying if the browser requires it. Saved mute is respected. Music pauses when the tab is hidden and on exit. Unsupported audio does not block play.

The Player and Banker panels each show three face-down cards with a lock icon before betting closes: two upright cards and a horizontal third card. Player's horizontal card comes first on the left; Banker's comes last on the right. After bets lock, cards flip individually in dealer order (Player, Banker, Player, Banker, then any actual third cards). A third card that is not drawn stays face-down and reads "No draw" after the result; it never contributes to the total. Card identities and partial totals are released only with the dealer's presented-card count; final scores and winner highlights appear after the full deal. The next betting window resets all six positions to face-down. Reduced-motion mode reveals faces without the rotation animation.

Statistics are visible by default: a Player/Banker/Tie pie chart and counts calculated from completed server rounds, followed by a scrollable P/B/T result strip, newest first. Empty history has no invented percentages. Each result cell opens the cards, scores, round ID, settlement time when available, naturals and pairs. The Results view retains the detailed list of both hands, and Roads retains Bead Plate and Big Road. A current deal joins the chart and history only after its full presentation finishes. History is restored from the shared clock on reload and includes rounds without a personal bet; no synthetic rounds are inserted by the application.

The browser suite covers commentary remaining disabled with old saved preferences, music controls and cleanup, sequential card reveal, historical cards after a round transition and reload, ties, naturals, pairs, empty history, media failure, betting and responsive layouts.
