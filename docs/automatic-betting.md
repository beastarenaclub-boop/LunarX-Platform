# Automatic submission of selected chips

Players select a stake and, where required, a table spot. There is no separate
Bet, Confirm, Deal, Roll or Drop button for a single wager.

- Live card/dice tables and crash games submit the selected stake when the
  displayed betting countdown reaches zero. Table requests include the selected
  round ID; the API rejects a stale round before debiting the wallet.
- Mines, Dice, Plinko, Rummy and Horse Racing use a visible three-second
  selection countdown. Cancel clears the pending selection.
- Defaults, page loads and new rounds do not arm a wager. An explicit coin,
  amount or horse selection is required. Existing repeat-play settings remain
  opt-in. Gameplay actions such as Cash Out, Hit and Stand remain available.
- A selection is submitted once. Rejections do not retry automatically or
  carry into a later round. Leaving a page cancels its local countdown.

Vegetable Bowl uses the live-table rule: select a shared coin and tap one or
more Normal/Hard/Risk options. Taps accumulate into one slip for the current
round. Cancel clears the whole draft. WinGo in the casino lobby also submits
its selected prediction at the betting deadline; its separate practice wallet
and five-second reveal lock remain unchanged.

The lobby games share `table-coins:v2:<userId>` preferences, including Mines,
Dice, Plinko, the crash variants, Vegetable Bowl and WinGo. Changing the visible
coins in settings never arms a bet. Fixed-entry games retain their allowed stakes.

Live betting displays a deadline 1,200 ms before server close, allowing the
request to travel before the authoritative deadline. A resumed/suspended tab
cannot dispatch a request past the send window. Crash panels share their draft
across mobile and desktop layouts and claim it synchronously before sending.

Regression coverage: `artifacts/3d-game/tests/auto-submit.spec.ts` and
`auto-submit-layout.spec.ts`; the table-round integration test checks stale
round rejection without a wallet debit. Browser tests intercept all wagers.
