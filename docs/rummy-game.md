# Rummy Royale

Open `/rummy` after signing in, or choose **Rummy Royale** in the lobby.
The server manages the table, shared wallet entries and winnings. An animated
fictional dealer and three computer opponents fill the other seats.

## Table rules

- Two decks, each with 52 suit cards and one printed joker; 13 cards per player.
- The indicator rank is wild. A printed-joker indicator makes aces wild.
- Draw one, then discard one. Open jokers cannot be picked. An open pickup
  cannot be immediately discarded again.
- Declare by choosing the discard from a 14-card hand. The remaining 13 need
  two sequences including one pure sequence; all remaining cards must also
  belong to valid sequences or sets. Duplicate physical cards never share a group.
- Aces are high or low, never wrapped. Sets have 3–4 different suits.
  Natural-position wild cards can form a pure sequence. Each group needs a
  natural card; all-joker groups are excluded by this table's house rule.
- Fixed entries of 10, 20, 50, 100, 200, 500, 1,000, 2,000, 5,000 or 10,000 wallet chips. The winner receives
  all four entries, with no fee. Points are guidance, not additional charges.
- Exhausting the closed deck or reaching 200 completed turns draws the round
  and returns the entries. A player can drop before drawing; their entry stays
  in the pot until the round settles.

Sequence/set conventions were checked against the
[RummyCircle 13-card rules](https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html).
The fixed-entry settlement, timeout and draw rules above belong to this table.

## Automatic play and persistence

Auto-play draws, selects a discard and declares a valid hand. Opponents use
only their own hand and the visible open card. Automatic decisions share the
same exact subset validator used for manual declarations.

Auto-bet starts a bounded run of 1–50 rounds and enables auto-play. It checks
net profit, net loss, affordable balance and remaining rounds before every
new entry. It also stops before a full lost entry could exceed the loss limit.
**Stop auto bet** cancels future entries; the current entry stays in play.
Auto-play can be toggled independently. Manual actions have a 20-second timeout.

The current round, auto-bet plan and turn deadline are stored on the server under
the signed-in user's ID. Reloading or returning resumes that table. Turn clocks
and bounded auto-bet runs continue after navigation or closing the tab. Use Stop
to cancel future entries. The balance comes from the shared wallet ledger;
there is no local refill. One chip represents one rupee.

## Implementation and checks

- `lib/api-zod/src/rummy.ts` and `rummy-session.ts`: shared deck, shuffle, meld
  validation, turn rules, computer decisions and bounded automatic play.
- `api-server/src/services/rummy.ts`: persisted turns and atomic wallet settlement.
- `src/game/rummy/useRummy.ts`: server snapshots and versioned player actions.
- `src/pages/Rummy.tsx` and `src/components/rummy/`: responsive table and hand
  controls, plus Lucky 7's casino studio and animated dealer. Rummy plays only
  the seated idle segment, with a still-image fallback for reduced motion or
  failed video playback.
- The fixed betting dock uses Lucky 7's chip artwork and blue/gold/rose controls.
  Picking a chip only selects the entry. **Repeat last** starts a new manual
  round using the previous round's entry. During play the dock collapses; use
  **Bet controls** to expand it. Entry selection stays locked until settlement.
- `tests/rummy-engine.spec.ts`, `rummy-auto.spec.ts`, `rummy-table.spec.ts`:
  card invariants, complete automated rounds, settlement, limits, authentication,
  reload and desktop/phone interaction tests. Browser tests mock the table API;
  `sharedWallet.integration.test.ts` verifies real ledger debits and payouts.

From the repository root:

```sh
pnpm --filter @workspace/3d-game typecheck
pnpm --filter @workspace/3d-game build
pnpm --filter @workspace/3d-game exec playwright test tests/rummy-engine.spec.ts tests/rummy-auto.spec.ts tests/rummy-table.spec.ts
```

Set `PLAYWRIGHT_BASE_URL` to the running player website. On Windows an installed
Chrome can be used through `PLAYWRIGHT_CHROMIUM_PATH`.

To update the local Docker website:

```sh
docker compose up -d --build --no-deps web
```
