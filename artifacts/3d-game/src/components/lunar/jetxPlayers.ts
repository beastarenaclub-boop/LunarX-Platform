import type { Bet, FakePlayerBet } from "@/game/store";

/** Merge server receipts with the live feed so your own bet appears even when
 * the websocket is reconnecting. The same receipt is never counted twice. */
export function jetxPlayers(roundId: string, live: FakePlayerBet[], realLive: boolean, mine: Bet[]): FakePlayerBet[] {
  const players = new Map((realLive ? live : []).filter(b => b.roundId === roundId).map(b => [b.id, b]));
  for (const bet of mine) {
    if (bet.roundId !== roundId) continue;
    players.set(bet.id, { ...bet, name: players.get(bet.id)?.name ?? "You" });
  }
  return [...players.values()];
}
