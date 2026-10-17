# Teen Patti: mobile layout and win celebration

The Teen Patti page keeps the dealer, bets and coins in document flow. A fixed
coin bar no longer covers the photographed table. Portrait keeps the dealer at
full available width; short portrait browsers put all five bet targets in one
row. Bets and coins retain at least 44px targets, and Any stays at least 48px high.
The last result, balance and header settings remain available.

Landscape mobile browsers place betting controls beside the table. On reveal,
the Auto camera keeps the complete dealer on the left and readable cards on the
right. The same video player, decoded-frame cues, physical card projection and
server deadlines continue to drive the game. The betting column remains reserved
during the closing cutoff, preventing a brief camera resize before the reveal.

Layouts use available browser dimensions and safe-area insets. History and the
paytable follow the playable controls in normal page flow. When an unusually
small browser window or on-screen keyboard leaves insufficient room, the page
can scroll instead of clipping controls or placing one panel over another.

Teen Patti now renders `TeenPattiResult` inside the table. Every completed deal
shows Player A wins, Player B wins, or Tie even when the viewer did not wager.
It waits until all six cards are face up. A settled personal win updates this
same panel to You Win with net profit and total returned; spectators never see
a personal win amount. The panel has an OK button (at least 44px), remains
inside the table in portrait and landscape, and clears when the next betting
window opens. It uses no page-wide backdrop or portal. Camera selection does
not hide it; the old rule hiding the winner badge in Auto/Cards was removed.

All table games now share `RoundWinDialog`, with a gold You Win celebration, net profit,
total payout (including the returned stake), and a 48px OK button. In both games,
a profitable individual
slip also produces a "Winning bet" receipt when other bets make the round break
even or lose overall; the round net loss is explicitly labelled with a minus
sign and is never presented as a profit. Its short-height layout
keeps the amount and action visible in landscape. The finite CSS celebration
honors reduced motion and needs no new media assets or external calls. Keyboard
focus starts on OK. Personal receipts clear when dismissed or when the next
round starts. Teen Patti keeps the shared receipt inside its table.
See [shared wins and preferences](table-game-preferences.md) for sound and coin settings.

Win eligibility still waits for the player's own settled slips and completed
card reveal. Pending slips, refunds, pushes and rounds with only losing slips
cannot trigger it. The shared clock fetches on entry to settlement even when
earlier snapshots missed the player's accepted slips, so final payouts are
not dependent on the delayed end-of-round event.
The personal win does not replay after OK, duplicate settlement, or reload.
The public table result is still available when joining an already revealed
deal. Lucky 7's game layout is unchanged.

Implementation:

- `artifacts/3d-game/src/pages/TeenPattiLive.tsx`
- `artifacts/3d-game/src/components/teenpattiLive/teen-patti-mobile.css`
- `artifacts/3d-game/src/components/teenpattiLive/tableCameras.ts`
- `artifacts/3d-game/src/components/teenpattiLive/FilmedTeenPattiTable.tsx`
- `artifacts/3d-game/src/components/teenpattiLive/TeenPattiResult.tsx`
- `artifacts/3d-game/src/components/teenpattiLive/teen-patti-result.css`
- `artifacts/3d-game/src/components/table/RoundWinDialog.tsx`
- `artifacts/3d-game/src/components/table/round-win-dialog.css`

Validation uses mocked API, WebSocket and wallet data. No real bets are placed.
`table-personalization.spec.ts` covers 14 portrait/landscape viewports from
320x568 through 960x540 and 768x1024, full dealer/control visibility, touch target
occlusion, all six result cards, win amounts, deduplication and reduced motion.
Popup bounds include 280x480 and 568x280. `teen-patti-studio.spec.ts` covers film
timing, card values, audio, fallback, reconnect, and instant betting behavior.

Validated on 2026-09-30: TypeScript checking and the Docker production build
passed. The combined browser suite passed 33 cases; five final-build checks
passed, including the additional closing-cutoff case (34 distinct cases overall).
The tested web image is running at `http://localhost:5174/teen-patti-live`.
Served dealer media hashes match the source files, and the new layout and
celebration CSS are present in the served build.

Popup follow-up: reproduced four failures on the prior build (mixed winning
and losing slips, and accepted slips absent from earlier snapshots, in both
games). After the fix, all 16 targeted browser checks passed, including those
four cases, complete 9-second reveal timing, mobile popup bounds, partial
settlement, deduplication, losses, pushes, refunds, and keyboard dismissal.
TypeScript and the Docker production build passed; the tested image was
deployed to localhost and verified against the running web container. All
test wagers and wallet responses were mocked.

Table overlay follow-up, 2026-10-01: reproduced the running-build failure where
`badge-deal-winner` existed but CSS made it hidden in the default hand camera.
The replacement is a table child, visible for Player A, Player B and ties
without requiring a wager. Nineteen preview checks passed, covering mobile
bounds, all three cameras, payouts, OK, reduced motion and next-round reset.
The normal production Docker build then passed three release checks: visible
public winner, personal You Win inside the table, and no winner before all six
cards finish revealing. The exact tested image was deployed and checked at
localhost:5174; dealer media hashes match the source. The temporary preview
used test-only fallbacks while unrelated video assets were being generated;
the deployed build used the standard Dockerfile and all actual media files.
