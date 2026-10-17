# One Day Dragon Tiger

Open `/dragon-tiger-one-day` from the existing lobby. The original Dragon Tiger remains at `/dragon-tiger`.

Uses the existing authenticated account, INR wallet ledger, shared coin preferences, sound settings and win receipt. One chip equals ₹1. No second balance is created.

## Round and markets

The server schedules a 48-second round: 20 seconds first bets, 3 seconds Dragon reveal transition, 15 seconds second bets, 3 seconds Tiger reveal transition, 7 seconds result. The visual betting countdown ends 1.2 seconds early to leave request transit time. Each player may submit one slip in each window, containing several markets. An accepted first-chance bet is required to unlock the second chance, enforced by both server and UI. No selections carry automatically into a new window.

First chance offers Dragon/Tiger/Tie/Suited Tie. After an accepted first bet and the Dragon reveal, the second chance offers those four match selections plus 26 Tiger card options: odd/even, red/black, low/seven/high, four suits, face/number and thirteen exact ranks. The compact panel groups these as Popular, Suit/Type and Exact Card, without a horizontal scroller. Match and Tiger selections are repriced; impossible or already certain outcomes close. Spectators who skipped the first chance get no second-window quotes.

Eight decks (416 physical cards), freshly sampled each round without replacement. Ace is 1 and King is 13. Suits do not break rank ties. Suited tie means equal rank and suit from different decks. Both Tie and Suited Tie bets win on a suited tie. **Main Dragon/Tiger selections lose on a tie in this variant.** There is no half-stake refund here.

Seven loses odd, even, low and high selections. Odd = A/3/5/9/J/K. Even = 2/4/6/8/10/Q. Low = A–6; high = 8–K. Face = J/Q/K; number = A–10. Minimum ₹1 per selected market, whole rupees only, maximum ₹5,000 total across both windows.

## Bhav

Displayed decimal odds are **total returns including the original stake**. Prices target a 95% theoretical expected return before rounding down:

`oddsHundredths = floor(95 × possible physical outcomes / winning physical outcomes)`

The opening sample space is `416 × 415`. The second window has exactly 415 possible Tiger cards after removing the exposed Dragon card. Prices use only this publicly revealed information, never the hidden Tiger card. For example, after a black Dragon is removed, Tiger red is 1.89×: a ₹100 winning bet returns ₹189. Main opening price is 2.05×, Tie 12.71×, Suited Tie 56.32×. These are this implementation's calculated prices, not a live operator's quote feed.

Integer paise settlement uses each slip's stored accepted odds. Advisory transaction locking, a unique round/user/stage constraint and wallet reference keys prevent duplicate debits and payouts. Late requests and price-window mismatches fail. Recovery settles all unfinished rounds, including players who have left the table. A second clock check after acquiring the wallet lock prevents queued bets crossing a deadline.

## Studio and disclosure

The studio preserves the original dealer and set using four new 1920×1080 Higgsfield / Seedance 2.5 takes: a steady six-second idle and four-second invite/Dragon/Tiger gestures. Gestures play once for betting, reveal and result events; selection reactions are throttled. Reveal takes run at 4/3 speed to fit the three-second transition. Hidden tabs pause playback, and reduced-motion users see the poster. The original breathing loop is no longer played. Generation IDs, references and directions are recorded in `motion-provenance.json` beside the media. This is an AI studio, not a live human broadcast; server card values determine results. Sounds retain the separate game sound design and common mute/volume controls.

The wallet header shows only the confirmed available balance. The receipt separately shows first stake, second stake, total debited and each accepted price/return. Selected coins do not reduce the displayed wallet. Polls started before a bet cannot overwrite its returned balance or accepted slips; duplicate submissions and reloads remain idempotent. The ₹5,000 combined round limit is displayed as the remaining allowance, including when the first chance has used it all.

SHA-256 of `dragonPhysicalId:tigerPhysicalId:nonce` is published before betting. Dragon is released only at second-window opening; Tiger and the 256-bit nonce only after final reveal. The result can be checked in the information dialog. This checks unchanged committed cards, not independent randomness certification.

## Market research (4 October 2026)

- [Universal API's casino integration documentation](https://universalapi.store/casino-docs) lists One Day Dragon Tiger separately and describes market snapshots, per-runner back/lay prices and hidden card placeholders. It does not establish a universal second-chance payout table. This implementation uses its own explicitly documented probability prices and supports back selections, without an exchange lay order book.
- [Totogaming's Dragon Tiger rules](https://totogaming.am/rules/en/regulations/casino) document odd/even and big/small options, including seven losing those side bets, as well as conventional tie payouts. The two-window rules and main-bet tie treatment above are specific to this new variant; they are not claimed as identical to that provider's game.

## Hindi dealer audio

`OneDayCommentary` selects an opening line, one of five analyses of the revealed Dragon card (Ace, 2–6, 7, 8–Q, King), and the server-confirmed Dragon/Tiger/Tie result. Revealing phases remain gesture-only. The selection never reads the hidden Tiger card. Commentary assets live in `public/media/dragon-tiger-one-day/commentary`; the manifest only enables files after the complete set has been rendered and checked.

Speech now plays from the filmed take's embedded AAC soundtrack. A cached `MediaElementAudioSourceNode` routes that single media element through the game's unlocked Web Audio context and a dedicated voice gain. Picture and speech share the browser's media clock, including pauses, buffering and seeks; there is no separate MP3 download, offset or periodic audio restart. Idle and gesture videos remain muted. A late-loaded line is skipped if it cannot finish before the phase ends. Each event plays once; a new phase, mute, lost connection, hidden tab or route exit stops the current line. Reduced-motion mode keeps the poster while still playing dealer speech and background music. If audio is blocked, a “Tap for dealer voice” button starts both the context and media playback in the user gesture.

The sound button restores zero master/effects levels to their defaults when explicitly enabled, and unlocks audio in that same tap. The studio's **Voice loud** button also raises quiet master/effects settings to at least 0.7/0.8, giving full speech volume with the dealer's 2× gain. Current commentary is preloaded even while muted. During buffering or an unexpected playback interruption, the speech frame remains visible; a voice tap resumes the same video from its current position. A phase deadline also stops stalled or blocked commentary. Browser checks measure nonzero voice samples after the speech gain node, rather than relying on the video's `paused` or decoder-byte counters.

The separate stereo lounge composition is original, generated by `scripts/prepare-one-day-music.mjs` (84 BPM, 44.1 kHz, 192 kbps MP3). It follows shared Sound/Music/volume preferences, pauses while the dealer speaks (including buffering) and returns over 650 ms afterward. Pausing keeps speech clear on mobile devices that ignore programmatic media volume. Browser autoplay restrictions require a first interaction when audio has not yet been unlocked. The generic game music is disabled specifically for this table so two tracks cannot overlap. `scripts/prepare-one-day-commentary.mjs` packages completed Higgsfield renders as 1080p, 8-bit H.264/AAC instead of device-dependent 10-bit HEVC, targeting -12 LUFS speech with a -1 dB true-peak limit. The louder clips have separate `-loud.mp4` filenames and an uncached manifest; `loudness-provenance.json` records measured levels for the remastered clips, whose original video streams and timing are preserved.

## Felt placement and generation status (10 October 2026)

The studio keeps the full 16:9 frame on desktop, phone and landscape layouts. Cards use proportional positions on the photographed felt, a tilted table perspective, contact shadows, and a staggered slide from the card shoe at the start of each round. Only server-revealed values turn the faces up. Reduced motion disables the dealing/reveal animation. These remain rendered game cards; the footage does not physically deal the server's cards.

New Higgsfield 720p native-audio takes were requested with `use_unlim: true` for both available Seedance variants (`seedance_2_0` and `seedance_2_0_mini`). Both submissions were rejected with “Unlimited generations aren't supported” for the selected model. No new generation was submitted and no paid fallback was used. The existing 1080p Seedance 2.5 footage remains in use; native playback fixes application-level drift, but does not regenerate or certify the original footage's phoneme accuracy.

The subsequent explicit `seedance_2_5`, 720p, native-audio, `use_unlim: true` request returned the same rejection. A balance/workspace check confirmed the connected Ultra plan, with no connector Unlimited allowance available. This does not establish whether the user's website Unlimited window is active. Higgsfield's [official MCP explanation](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp) distinguishes website Unlimited access from credit-based connector generation. No credit-based submission was made.

### Studio camera controls

Wide resets the full studio to 100%; Dealer frames the presenter at 150%; Cards frames both table positions at 200%. The slider and plus/minus controls allow 100–200% magnification. Footage and server card faces sit in one transformed camera layer, keeping the cards attached to the photographed felt. This is digital magnification of the existing render, not newly generated detail or a separate camera angle.

Cards reuse the application's vector deck artwork, with matching numeric pip counts, mirrored corner ranks/suits, illustrated court cards and patterned backs. The vector artwork stays sharp when enlarged; only revealed server values reach the face component.

Full screen enlarges the same mounted player through the browser Fullscreen API. Browsers that decline it get an expanded in-page view with keyboard focus containment and Escape to close. Camera changes and expansion preserve the media element, native audio clock and current round; hidden card faces remain hidden and betting deadlines continue normally. Controls remain outside the zoom layer in one compact row on phones, replacing the redundant phase strip; the betting panel still shows the active phase and countdown. Reduced-motion preferences disable the camera transition.

## Run and checks

`docker compose up -d --build --wait api web` applies migration `0040_dragon_tiger_one_day` and updates the lobby at http://127.0.0.1:5200/.

- Math/disclosure tests: from `artifacts/api-server`, run `node --import tsx --test src/services/__tests__/dragonTigerOneDay.test.ts`.
- Wallet integration: migrate a dedicated PostgreSQL database whose name ends `_one_day_test`, set `ONE_DAY_TEST_DATABASE_URL`, then run the adjacent `.integration.test.ts`. This test refuses any other database name.
- Browser tests: run Vite with `vite.one-day.config.ts` on port 5291, then from the repository root run `node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.one-day.config.ts`. The test preview disables hot reload to keep timed bets stable during unrelated workspace edits. Supports `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_CHROMIUM_PATH` overrides.
