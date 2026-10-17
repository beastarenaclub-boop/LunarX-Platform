# Shared table wins and preferences

Lucky 7, Teen Patti (both versions), Dragon Tiger, Rummy, Roulette, Baccarat,
Blackjack and Andar Bahar use the same win receipt and recorded coin celebration.
Teen Patti Live renders that receipt inside the filmed table; other tables use
the shared dialog. Both show net profit and total returned, support keyboard
dismissal, and respect reduced motion.

When adding another table:

- Use `useRoundWin` with the authenticated user, current round ID and final
  settled bets. Set `eligible` only after the result animation and settlement
  finish. Pending bets, refunds and pushes alone must not trigger a win.
- Render `RoundWinDialog` with the hook's `win` and `dismiss`. The hook owns the
  celebration sound and deduplicates by game, player and round; do not play a
  second win sound in the page. Pass `unit: "chips"` for whole practice chips;
  the default expects integer paise and displays rupees.
- Use `useCoinPreferences` with the user ID and the game's maximum denomination.
  `TableCoinRack` combines the rack and settings. Custom layouts can use
  `CoinSettingsButton` and `CoinSettingsDialog` separately.
- Games with fixed entries, such as Rummy, pass their allowed denominations to
  both the hook and dialog. Filtering preferences must never change game rules.

Coin preferences are stored per player in `table-coins:v2:<userId>` and shared
across tables. The first visited table's existing v1 choice is migrated if no
shared choice exists. Saving from a capped table preserves denominations that
only other tables support. A table with no matching saved denomination falls
back to its supported defaults so a player always has an available coin.

`TableSoundSettings` edits the existing persisted global sound, master, effects
and button volumes. Muting does not hide the win receipt. Win history remains
per game and player in session storage and is independent of coin preferences.

Game audio now attempts playback on entry, without waiting for a bet. The
shared music bus arms as soon as an authenticated game route opens; standalone
games and filmed tables start their own mixes through the same autoplay retry
helper. A browser block is retried on a normal pointer/touch/key gesture, on
returning to the tab, or after restoring a page. Explicit mute and volume
choices still apply. Leaving the game or hiding the tab stops its music, and
time-sensitive speech is cancelled rather than queued for a later round.
Virtual sports starts with commentary enabled and saves its subsequent mute
choice under `arena:sound:auto-v1`.
