import { createHash, createHmac } from "node:crypto";
import {
  LUDO_SAFE,
  ludoOffset,
  type LudoState,
  type LudoPlayer,
} from "@workspace/api-zod/ludo";
export const commitment = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");
/** Rejection sampling avoids modulo bias. Nonce is persisted with every roll. */
export function ludoDie(seed: string, matchId: string, nonce: number): number {
  for (let block = 0; ; block++) {
    const bytes = createHmac("sha256", seed)
      .update(`ludo:v1:${matchId}:${nonce}:${block}`)
      .digest();
    for (const byte of bytes) if (byte < 252) return (byte % 6) + 1;
  }
}
const absolute = (p: LudoPlayer, pos: number) =>
  (ludoOffset(p.color) + pos) % 52;
/** Safe squares may be shared. This variant has no blocking stacks. */
export function legalTokens(state: LudoState): number[] {
  const p = state.players[state.turn];
  if (
    !p ||
    p.forfeited ||
    state.phase !== "move" ||
    !state.dice ||
    state.winner !== null
  )
    return [];
  return p.tokens.flatMap((pos, i) =>
    (pos === -1 ? state.dice === 6 : pos < 56 && pos + state.dice! <= 56)
      ? [i]
      : [],
  );
}
export function nextTurn(s: LudoState) {
  s.sixes = 0;
  s.phase = "roll";
  s.dice = null;
  for (let i = 1; i <= s.players.length; i++) {
    const next = (s.turn + i) % s.players.length;
    if (s.players[next] && !s.players[next]!.forfeited) {
      s.turn = next;
      return;
    }
  }
}
/** Only finished tokens count at the ten-minute cutoff; progress never breaks a tie. */
export function timedWinners(s: LudoState): number[] {
  const active = s.players.filter((p): p is LudoPlayer => !!p && !p.forfeited);
  const best = Math.max(
    ...active.map((p) => p.tokens.filter((t) => t === 56).length),
  );
  return active
    .filter((p) => p.tokens.filter((t) => t === 56).length === best)
    .map((p) => p.seat);
}
export function rollDie(s: LudoState, dice: number) {
  if (s.phase !== "roll" || s.winner !== null || dice < 1 || dice > 6)
    throw new Error("Cannot roll now");
  const p = s.players[s.turn]!;
  s.rollNonce++;
  s.dice = dice;
  s.phase = "move";
  s.sixes = dice === 6 ? s.sixes + 1 : 0;
  s.last = { seat: s.turn, dice, text: `${p.name} rolled ${dice}` };
  if (s.sixes === 3) {
    s.last.text += " · third six, turn ends";
    nextTurn(s);
  } else if (!legalTokens(s).length) {
    s.last.text += " · no legal move";
    if (dice === 6) {
      s.phase = "roll";
      s.dice = null;
    } else nextTurn(s);
  }
}
export function moveToken(s: LudoState, token: number) {
  if (!legalTokens(s).includes(token))
    throw new Error("Choose a highlighted token");
  const p = s.players[s.turn]!,
    dice = s.dice!;
  const pos = p.tokens[token] < 0 ? 0 : p.tokens[token] + dice;
  p.tokens[token] = pos;
  let captured = 0;
  if (pos <= 50 && !LUDO_SAFE.includes(absolute(p, pos))) {
    for (const other of s.players)
      if (other && other.seat !== p.seat && !other.forfeited) {
        other.tokens.forEach((op, i) => {
          if (op >= 0 && op <= 50 && absolute(other, op) === absolute(p, pos)) {
            other.tokens[i] = -1;
            captured++;
          }
        });
      }
  }
  s.last = {
    seat: p.seat,
    dice,
    token,
    captured,
    text: `${p.name} moved token ${token + 1}${captured ? ` · captured ${captured}` : pos === 56 ? " · home!" : ""}`,
  };
  if (p.tokens.every((t) => t === 56)) {
    s.winner = p.seat;
    s.last.text = `${p.name} wins!`;
    return;
  }
  if (dice === 6 || captured || pos === 56) {
    s.phase = "roll";
    s.dice = null;
  } else nextTurn(s);
}
/** Same public board and legal moves as a human; never reads the secret or future dice. */
export function computerToken(s: LudoState): number {
  const choices = legalTokens(s),
    p = s.players[s.turn]!;
  return (
    choices
      .map((token) => {
        const trial = structuredClone(s);
        moveToken(trial, token);
        const pos = trial.players[s.turn]!.tokens[token];
        const score =
          (trial.winner !== null ? 10000 : 0) +
          (pos === 56 ? 1000 : 0) +
          (trial.last?.captured ?? 0) * 200 +
          (p.tokens[token] < 0 ? 70 : 0) +
          (pos <= 50 && LUDO_SAFE.includes(absolute(p, pos)) ? 30 : 0) +
          pos;
        return { token, score };
      })
      .sort((a, b) => b.score - a.score || a.token - b.token)[0]?.token ?? -1
  );
}
