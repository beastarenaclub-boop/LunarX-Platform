# Player website quality audit — 19 October 2026

Released player commit: `a9b2ad9537df4b42aabba88440ef4eaf970bdfff`.
Render web deployment: `dep-dbana6ijnfac738d11h0`.
Production verification report generated: 2026-10-19T01:52:46.802Z.

## Changes and measured result

The mobile lobby's early resource transfer fell from **15.54 MB to 2.34 MB (84.9% less)**. This is resource bytes observed by Chrome at 390 × 844, DPR 1, three seconds after the game grid appeared, with a new browser context, without CPU/network throttling. It measures the initial transfer window, not total eventual downloads or a guaranteed load time on every connection.

- Added content-hashed WebP artwork, mobile hero variants and immutable caching. The original artwork remains available. Verified both Crypto777 hostnames, login-channel behavior and layouts at widths 320, 390 and 1440; Normal Play / Agent Play buttons remain absent.
- Teen Patti Live mobile film: 5,274,411 → 416,964 bytes (92.1% smaller). Limited DOM animation work to 30 updates/second on light devices and 60 on desktop, cached layout measurements, and recovered to a poster if film loading stalls. Original desktop film retained.
- Lucky 7 mobile idle/action films: previous 1080p pair 10,310,035 → 1,601,689 bytes (84.5% smaller). Added native range streaming, metadata-timeout fallback and deferred secondary loading. The new 720p copies come from the original 2K sources; loop and action transitions passed pixel-continuity checks. Desktop retains its original high-resolution film.
- Wheel 2 Live mobile film set: 23,576,920 → 3,931,813 bytes (83.3% smaller), with only the current clip loaded immediately. Preserved the RGB/alpha packing, reduced mobile compositing resolution and skipped duplicate video frames. Verified the host foreground, audible commentary, wheel release timing and final result synchronization.
- Horse Racing uses the existing Three.js scene on mobile/light devices; desktop retains Unity. Verified eight runners, a rendering canvas and no mobile Unity download. This reduces the heavy Unity startup path, but the fallback still has substantial 3D assets and is not a zero-download game.
- JetX and Fury onboarding now show the correct game name and icon.

Desktop Horse Racing had a 10 callbacks/second sample immediately after startup in the route sweep. An isolated, longer follow-up on Intel Iris Xe recovered to approximately 47–60 callbacks/second while racing and 110 between races, without JavaScript errors. These are requestAnimationFrame diagnostics, not a direct measurement of Unity-rendered frames. This startup dip and the remaining large 3D downloads mean that universal lag-free operation is not established.

Production returned HTTP 200 for all 20 new image/video assets, with immutable cache headers. Both player hostnames returned HTTP 206 and exactly 1,024 bytes for the requested video range, confirming streaming support.

## Validation and coverage

- Production player build and TypeScript check passed. Build emitted existing source-map/chunk-size warnings.
- The nine real demo-worker integration tests passed: shared table wagers, instant collections, both crash games, Rummy, trading, lotteries, dragon tables, racing, all five virtual sports, session isolation and financial-route restrictions. These run the actual demo engines with synthetic RAM-only sessions; acceptance and settlement coverage varies by game.
- Additional live-browser demo tests verified the current JetX and Fury controls: correct onboarding, one accepted wager and no duplicate submission per selected panel. Fresh sessions were explicitly verified as demo sessions before either test.
- All 40 catalog games rendered on desktop and mobile before release. All 40 were visited again in mobile view after release; the four changed heavy games were rechecked on desktop. Each route was inspected for JavaScript errors, failed HTTP responses, missing loading completion and horizontal overflow. All passed these checks. Horse and Formula checks also waited for their actual scene readiness.
- Storefront checks passed. Targeted Lucky 7, Teen Patti, Wheel and mobile Horse tests covered video quality, failures, animation, sound and responsive layouts. Wheel's 23 scenarios passed across the full run and targeted correction/recheck; Lucky 7's eight video scenarios likewise passed across runs. Current Mines/Dice/Plinko/Vegetable/WinGo draft-cancellation and once-only submission tests passed.
- The entire repository test suite is **not** certified green: older UI tests still reference retired `/play` / `/aviator` routes, removed coin presets or the previous immediate-bet interaction. Those obsolete assertions were not treated as live game failures, and product behavior was not reverted to satisfy them.
- No deposits, withdrawals or real-money wagers were performed. Demo tests are not an audit of production financial settlement.

## Catalog route results

“Pass” below means the browser route/render checks above, not a full manual playthrough of every possible game state. Desktop results are the full pre-release audit plus focused post-release checks for changed games; mobile results are post-release.

| Game | Route | Mobile after release | Desktop |
| --- | --- | --- | --- |
| Teen Patti Live | `/teen-patti-live` | Pass | Pass |
| Teen Patti 20/20 | `/teen-patti` | Pass | Pass |
| Rummy Royale | `/rummy` | Pass | Pass |
| Blackjack | `/blackjack` | Pass | Pass |
| Lucky 7 Live | `/lucky-7-live` | Pass | Pass |
| Roulette | `/roulette` | Pass | Pass |
| Lucky 7 | `/lucky-7` | Pass | Pass |
| Baccarat VIP | `/baccarat` | Pass | Pass |
| Andar Bahar Live | `/andar-bahar-live` | Pass | Pass |
| Dragon Tiger | `/dragon-tiger` | Pass | Pass |
| One Day Dragon Tiger | `/dragon-tiger-one-day` | Pass | Pass |
| Crazy Time | `/crazy-time` | Pass | Pass |
| Wheel 2.0 Live | `/wheel-2-live` | Pass | Pass |
| 7up7down | `/7up7down` | Pass | Pass |
| Andar Bahar | `/andar-bahar` | Pass | Pass |
| Prize Lotto | `/prize-lotto` | Pass | Pass |
| Cricket Super Six | `/virtual-sports/cricket` | Pass | Pass |
| Football Arena | `/virtual-sports/football` | Pass | Pass |
| Basketball Pro | `/virtual-sports/basketball` | Pass | Pass |
| Tennis Masters | `/virtual-sports/tennis` | Pass | Pass |
| Formula Sprint | `/virtual-sports/formula` | Pass | Pass |
| Horse Racing | `/horse-racing` | Pass | Pass |
| Bike Racing | `/bike-racing` | Pass | Pass |
| Irland Lotto | `/lottery` | Pass | Pass |
| JetX | `/jetx` | Pass | Pass |
| Fury Flight | `/fury` | Pass | Pass |
| Chicken Road | `/chicken-road` | Pass | Pass |
| Chicken Road 2.0 | `/chicken-road-2` | Pass | Pass |
| Chicken Road Pirate Edition | `/chicken-road-pirate` | Pass | Pass |
| Pirate Jackpot Mines | `/pirate-jackpot-mines` | Pass | Pass |
| Duck Duel | `/duck-duel` | Pass | Pass |
| Tower Rush | `/tower-rush` | Pass | Pass |
| Jackpot Fishing | `/jackpot-fishing` | Pass | Pass |
| Mines | `/mines` | Pass | Pass |
| Coin Flip | `/coin-flip` | Pass | Pass |
| Plinko | `/plinko` | Pass | Pass |
| Lunar Colour Trading | `/lunar-colour-trading` | Pass | Pass |
| Forex Trading | `/forex-trading` | Pass | Pass |
| Dice | `/dice` | Pass | Pass |
| Vegetable Bowl | `/vegetable-bowl` | Pass | Pass |

## Maintenance and remaining limits

No enabled catalog game had a confirmed persistent failure requiring a new maintenance flag. The existing disabled Sic Bo entry was left disabled. No user-account or game-registry settings were changed.

Both https://crypto777.club/ and the supplied https://crypto777.club/sport returned HTTP 403 “WAF Block” in the available browser. Its demo could not be inspected, so no reference-derived new game was added.

These checks used Chrome on this Windows computer with emulated viewport sizes, not physical low-end phones or every browser/network. Frame samples are diagnostics and do not guarantee every game's graphics will run without lag everywhere. Long-run load, concurrent-user capacity and every real-money round remain outside this verified scope.

Detailed diagnostic JSON, screenshots and test logs are retained locally in `.cache/quality-audit/` (not committed). Reproducible media generators are `tools/optimize-storefront-media.mjs` and `tools/optimize-game-media.mjs`.
