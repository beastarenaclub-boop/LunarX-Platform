import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetWalletBalanceQueryKey,
  useRealtimeTopic,
} from "@workspace/api-client-react";
import { useTableRound } from "@/components/table/useTableRound";
import {
  AUTO_SEND_AT_MS,
  BAR_FLASH_HALF_MS,
  BATCH_ACK_TIMEOUT_MS,
  DEFAULT_CHIP,
  FLASH_MS,
  LAST_SECONDS,
  NOTICE_MS,
  STALE_BOARD_MS,
  TAKE_PRE_DELAY_MS,
  TAKE_TICK_MS,
  type ChipValue,
} from "./layout";
import { rouletteSounds } from "./sounds";
import { setWheelZoom, useWheelZoom } from "./wheelZoom";
import { stakeKey, type BetType, type Wheel, coveredPockets } from "./wheelSpec";
import type { Stake } from "./BetChart";

/**
 * The wallet query these tables share with the crash game. The generated key,
 * not a hand-written `["wallet"]` — the first version invalidated a key nothing
 * was subscribed to, and the Score sat on its pre-bet number until the player
 * happened to refocus the tab.
 */
const WALLET_KEY = getGetWalletBalanceQueryKey({ game: "lunar" });

/** One point is one rupee is one hundred paise. The chips are denominated in points. */
export const PAISE_PER_POINT = 100n;

/**
 * The table minimum while the config call has not answered.
 *
 * The cabinet falls back to 5.00 and no ceiling. Three of the four gates here
 * fell back to ZERO and the fourth showed 5, so the number the player was told
 * and the number they were judged by disagreed, and the client-side minimum
 * was a no-op until the config landed.
 */
export const MIN_STAKE_FALLBACK_PAISE = 500n;

/** The table minimum in paise, with that fallback. One reader for all four gates. */
export const minStakePaiseOf = (
  cfg: { minStakePaise: string } | null | undefined,
): bigint => (cfg ? BigInt(cfg.minStakePaise) : MIN_STAKE_FALLBACK_PAISE);

export interface RouletteConfig {
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: string;
  minStakePaise: string;
  maxBetsPerSlip: number;
  wheel: {
    code: string;
    numberCount: number;
    pocketCount: number;
    doubleZero: number;
    third: number;
    half: number;
  };
  paytable: Record<string, number>;
  limits: Record<string, { min: number; max: number }>;
}

interface WinMeter {
  pendingWin: { amountPaise: string; roundId: string | null } | null;
  layout: { pocket: number | null; bets: SettledBet[] } | null;
}

interface SettledBet {
  type: BetType;
  selection: number[];
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

/** A position with money staged on it, not yet sent. */
interface StagedChip {
  type: BetType;
  selection: number[];
  paise: bigint;
}

const wholePoints = (paise: bigint): number => Number(paise / PAISE_PER_POINT);

/**
 * The game screen's whole state machine.
 *
 * Kept out of the component because it is the part with rules in it: the
 * one-confirm-per-round lock, the deadline auto-send, the WINNER meter's drain
 * and the clock's freeze all have to agree with each other, and reading them
 * next to each other is the only way to see that they do.
 */
export function useRouletteGame(wheel: Wheel, balancePaise: bigint | null) {
  const qc = useQueryClient();

  // ── server state ─────────────────────────────────────────────────────────
  const round = useTableRound<{ pocket: number }>(wheel.code, {
    // This cabinet has its own nine recordings and no croupier. See the note on
    // the option itself.
    croupierVoice: false,
    onBettingOpen: () => onRoundOpen(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: WALLET_KEY });
      void refetchMeter();
    },
  });

  const configQuery = useQuery<RouletteConfig>({
    queryKey: [wheel.code, "config"],
    queryFn: () =>
      customFetch<RouletteConfig>(`/api/${wheel.code}/config`, {
        method: "GET",
        credentials: "include",
      }),
    retry: false,
    // Re-read on every mount, never served from a cache across one. The limits
    // are what a chip is judged by, and a table opened twice inside a minute
    // was judging the second visit against the first visit's numbers.
    staleTime: 0,
    refetchOnMount: "always",
  });

  /**
   * The board's own copy of the limits follows an operator's edit.
   *
   * `useTableRound` already listens on this topic, but only for the ROUND's
   * config — the per-position bands and the table minimum live in this query,
   * which nothing invalidated. After a limits change the chart went on judging
   * chips against the old bands for the life of the mount, so it accepted what
   * the server then refused (and refused what it would have allowed) with a
   * message quoting numbers that were no longer real.
   */
  useRealtimeTopic<{ type?: string }>(`game-config:${wheel.code}`, (ev) => {
    if (!ev || ev.type !== "updated") return;
    void qc.invalidateQueries({ queryKey: [wheel.code, "config"] });
  });

  /**
   * Whether the meter must be POLLED right now: a round of ours is settled and
   * waiting for its reveal, and the win for it has not been parked yet.
   *
   * On the local table the meter is armed AT settlement, so the one refetch
   * `onSettled` fires captures the win before the ball drops. On a partner
   * table the meter arms only when the CREDIT IS DELIVERED — the dispatcher
   * ticks every 3 s and then makes an HTTP call — which lands a few seconds
   * after settlement, i.e. right around the moment `onSettled` fired. That
   * single read raced the delivery and lost as often as not, and the next
   * read was the one at ring stop: the ball stopped on a winning pocket with
   * no verdict, and the celebration came up seconds later, over the next
   * round's clock. Local players saw the result at ball stop; the same
   * player through a partner iframe saw it after the next round had started.
   *
   * Refs, not state: react-query calls this after every fetch and a render
   * per poll is not wanted. It stops itself the moment a win is parked or
   * the reveal happens, so the local table pays for at most one extra read.
   */
  const awaitingWinRef = useRef(false);
  const meterQuery = useQuery<WinMeter>({
    queryKey: [wheel.code, "win"],
    queryFn: () =>
      customFetch<WinMeter>(`/api/${wheel.code}/win`, {
        method: "GET",
        credentials: "include",
      }),
    retry: false,
    staleTime: 2_000,
    refetchInterval: () => (awaitingWinRef.current ? 1_000 : false),
  });
  const refetchMeter = useCallback(() => meterQuery.refetch(), [meterQuery]);

  // ── screen state ─────────────────────────────────────────────────────────
  const [chip, setChip] = useState<ChipValue>(DEFAULT_CHIP);
  const [staged, setStaged] = useState<StagedChip[]>([]);
  const stagedRef = useRef<StagedChip[]>([]);
  stagedRef.current = staged;
  const [betPlaced, setBetPlaced] = useState(false);
  /**
   * The deadline sent this round's layout. Its ONE job (parity spec 08 §7.3,
   * third edition, third pass): who placed the layout decides what the close
   * says. A player who pressed Bet Ok was told the bet was on at the press,
   * so when the window shuts the news is `Bet Time Over.`; a layout the
   * deadline sent keeps saying `Your Bet Has Been Accepted.`, because nobody
   * pressed anything and "Bet Time Over." would be the only thing they were
   * ever told about a bet that went on. (The first pass deleted the flag;
   * that went too far in one direction.)
   */
  const [autoSent, setAutoSent] = useState(false);
  /**
   * The staged TOTAL has reached the table minimum at least once this round
   * (08 §7.1). The line then reads the CHOICE — keep building or confirm —
   * and it LATCHES: taking chips off again is a player editing their own
   * layout, not one who needs telling to start. Cleared on round open and
   * when the layout is sent, where the acceptance takes the line.
   */
  const [reachedMinimum, setReachedMinimum] = useState(false);
  const [removing, setRemoving] = useState(false);
  /**
   * The spot the player touched last, for Cancel Specific's arming press. The
   * press almost always means "not that one" about the chip just put down, so
   * it goes at once (parity spec 09 §"ARMING IT ALSO TAKES THE LAST CHIP
   * OFF"). Consumed by that press whether or not the chip is still there, and
   * cleared by a removal by hand, by Prev Bet (a replay is not "that one") and
   * by the confirm.
   */
  const justStakedRef = useRef<{ type: BetType; selection: number[] } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // App-scoped, shared by both wheels — see `wheelZoom.ts`.
  const zoomOn = useWheelZoom();
  /**
   * `!zoomOn`: the table is ALREADY takeable, so a tap on it places a chip
   * rather than expanding it (the cabinet's `_betsWhereItSits`).
   */
  const betsWhereItSits = !zoomOn;
  const [spinning, setSpinning] = useState(false);

  /** Facts of the round waiting to be shown, captured when betting closes. */
  const [pending, setPending] = useState<{
    roundId: string;
    staked: boolean;
    stakes: Stake[];
    totalPaise: bigint;
  } | null>(null);
  const [revealedRoundId, setRevealedRoundId] = useState<string | null>(null);
  /**
   * The win waiting for a round the wheel has NOT yet shown — the cabinet's
   * `_pendingWinMinor`.
   *
   * The server's meter is read ahead of the reveal (settlement fires
   * `onSettled`, which refetches it, and the round's own settling poll keeps
   * it moving), and the value is parked here HIDDEN until the ball stops.
   * That is what lets `onResultShown` decide win or lose on the frame the ring
   * stops instead of asking the network at the one moment it must not: parity
   * spec 08 step 9 stores the win but keeps `_winShown` false while the reveal
   * for that round has not happened, and step 11 decides from the captured
   * value.
   *
   * A ref, not state: the reveal reads it inside a callback whose dependency
   * list is deliberately pinned, and a re-render is not wanted just because a
   * number the player cannot see yet has arrived.
   */
  const capturedWinRef = useRef<{
    roundId: string;
    paise: bigint;
    stakes: Stake[];
  } | null>(null);
  const [flashPocket, setFlashPocket] = useState<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [lost, setLost] = useState(false);

  /** The WINNER meter, in paise, as the SCREEN shows it. */
  const [meterPaise, setMeterPaise] = useState(0n);
  const [meterShown, setMeterShown] = useState(false);
  const [taking, setTaking] = useState(false);
  const [frozenAtZero, setFrozenAtZero] = useState(false);
  /** The winning layout, held on the chart until TAKE. */
  const [heldStakes, setHeldStakes] = useState<Stake[] | null>(null);

  /** The last confirmed layout — what Prev Bet re-stages. Memory only. */
  const lastBetsRef = useRef<StagedChip[]>([]);
  const [betThisRound, setBetThisRound] = useState(false);
  const [offerPrevBet, setOfferPrevBet] = useState(false);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // ── clocks ───────────────────────────────────────────────────────────────
  const snap = round.snapshot;
  /**
   * What this player already has ACCEPTED on the open round.
   *
   * The per-position band is a property of the position across the whole
   * round, not of one placement, so both optimistic checks below have to count
   * it — otherwise the client says yes to a chip the server refuses.
   */
  const placedByPosition = useMemo(() => {
    const out = new Map<string, bigint>();
    for (const slip of snap?.myBets ?? []) {
      if (slip.status === "refunded") continue;
      if (!Array.isArray(slip.bets)) continue;
      for (const raw of slip.bets as SettledBet[]) {
        const sel = Array.isArray(raw.selection) ? raw.selection : [];
        const key = spotKey(raw.type, sel);
        out.set(
          key,
          (out.get(key) ?? 0n) + BigInt(raw.amountPaise ?? "0"),
        );
      }
    }
    return out;
  }, [snap?.myBets]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const toLocal = round.toLocalTime;
  /**
   * Is the snapshot describing the round the socket is watching?
   *
   * The clocks below are built from the SNAPSHOT, which is a REST read with
   * `retry: false` — react-query keeps the previous data when a refetch fails.
   * One failed refetch at a round boundary therefore left the snapshot on the
   * OLD round while the socket had already moved to the new one, and every
   * clock read zero: betting closed for the whole window, the count stuck at
   * 0:00, no reconnecting warning because the socket was fine, and the phase
   * watchdog could not help because its own deadline was the new round's.
   *
   * When the two disagree the socket is the one that is current, so fall back
   * to its drift-corrected deadline rather than to a stale zero.
   */
  const snapIsCurrent =
    snap !== null && (round.roundId === null || round.roundId === snap.roundId);
  const livePhaseLeftMs = round.remainingMs;

  /**
   * The BETTING clock — what every bet gate reads.
   */
  const bettingLeftMs = !snap
    ? 0
    : snapIsCurrent
      ? Math.max(0, toLocal(snap.bettingEndsAt) - now)
      : round.phase === "betting"
        ? livePhaseLeftMs
        : 0;
  /**
   * The clock ON SCREEN: ONE count for the whole round, betting window and
   * closed tail together. It is not the betting clock and must not be — the
   * cabinet counts the round down to zero and the wheel spins at zero.
   */
  /**
   * The stale-snapshot fallback has to add the STRETCH STILL TO COME.
   *
   * `round.remainingMs` is what is left of the current PHASE, and this clock
   * counts the whole round — so on a new round the socket announces before the
   * snapshot refetch lands, handing the betting phase's own remainder straight
   * to the display showed 50s on a 60s round: the clock hit 0:00, flashed
   * 0:50 for a frame or two, then jumped to 1:00 when the snapshot arrived.
   *
   * Reading the durations off the ROUND's config rather than off the previous
   * snapshot's tail, because the new round is the one being counted and its
   * window is what the player is about to bet in.
   */
  const revealMs = round.config?.revealDurationMs ?? 0;
  const settleMs = round.config?.settleDurationMs ?? 0;
  const liveRoundLeftMs =
    round.phase === "betting"
      ? livePhaseLeftMs + revealMs + settleMs
      : round.phase === "reveal"
        ? livePhaseLeftMs + settleMs
        : livePhaseLeftMs;
  const displayLeftMs = !snap
    ? 0
    : snapIsCurrent
      ? Math.max(0, toLocal(snap.settleEndsAt) - now)
      : // Stale snapshot: the socket knows how long THIS phase has left, and
        // the config knows what follows it.
        liveRoundLeftMs;
  /** The closed stretch: reveal plus settle. */
  const tailMs = snap ? Math.max(0, snap.settleEndsAt - snap.bettingEndsAt) : 0;

  const acceptsBets = round.phase === "betting" && bettingLeftMs > 0;

  // ── the blinks ───────────────────────────────────────────────────────────
  // One beat for the winning cell, TAKE and Bet Ok. The clock bar runs on its
  // OWN, slower beat: sharing a controller would drag the cell to the bar's.
  /**
   * Both controllers START when the blink is wanted, LIT, and stop when it is
   * not.
   *
   * They used to free-run from mount with only the render gated, so the phase
   * at the moment a blink became visible was arbitrary: the winning cell could
   * appear DARK for up to 167 ms after the reveal, or flash a first lit half a
   * millisecond long. The cabinet calls `repeat()` when it wants the blink,
   * and `repeat()` restarts from value 0 — lit — so the first half is always a
   * whole one.
   */
  const blinkWanted =
    flashPocket !== null || (meterShown && meterPaise > 0n) || staged.length > 0;
  const flashOn = useBlink(blinkWanted, FLASH_MS / 2);

  /**
   * The closing stretch, counted in DISPLAYED seconds.
   *
   * The spec's window is the shown clock in `[tail, tail + 5]` INCLUSIVE — 15
   * down to 10 on the default tail, six whole seconds. Expressed as a raw
   * millisecond span it came out one second short and started a second late,
   * so the bar began warning at 14 rather than 15. Derived off the same floor
   * the clock itself uses, or the cue and the digit disagree about which
   * second it is.
   */
  const shownSecond = Math.floor(displayLeftMs / 1000);
  const tailSecond = Math.floor(tailMs / 1000);
  // (tail, tail + 5]: 15 down to 11 on the default tail and OUT at a shown
  // 10, which is the second betting shuts on — a flash there was a warning
  // about something the player could no longer do (third edition, T-10).
  const lastSeconds =
    displayLeftMs > 0 &&
    shownSecond > tailSecond &&
    shownSecond <= tailSecond + LAST_SECONDS;

  // The clock bar runs on its OWN, slower beat: sharing a controller would drag
  // the cell to the bar's. Same start-when-wanted rule as the shared blink.
  const barFlashOn = useBlink(lastSeconds, BAR_FLASH_HALF_MS);

  /**
   * "No board yet" and "the board has stopped updating" are DIFFERENT, and the
   * screen used to say "Reconnecting" for both.
   *
   * It read `snapshot !== null`, which is wrong at both ends. A partner's
   * stream is cold routinely — nobody is at the table, so it parks and
   * retires — and `/round` honestly answers null while it wakes, so every
   * partner launch opened on a reconnect warning for a table that was fine.
   * And once a snapshot has arrived it is never cleared, so an actually
   * dropped socket showed a live-looking board with a running clock.
   *
   * "No round yet" is NOT offline: the cabinet's status order has
   * `Reconnecting . Betting is paused` at priority 2 and
   * `Waiting for the next round .` at priority 13, so conflating them made the
   * second unreachable — a state that happens on every partner launch showed
   * as a fault. Only `stale` feeds the offline line now, and a stream with no
   * round falls through to its own.
   *
   * `stale` is measured off the only clock that survives a round: a healthy
   * table opens the next one the moment this one's settle deadline passes, so
   * a count that has sat at zero far longer than that is not a table between
   * rounds. The deliberate hold on a win is excluded — that one is stopped on
   * purpose.
   */
  const lastRoundChangeRef = useRef(Date.now());
  useEffect(() => {
    lastRoundChangeRef.current = Date.now();
  }, [round.roundId]);
  const waiting = snap === null;
  const stale =
    !waiting &&
    !frozenAtZero &&
    displayLeftMs === 0 &&
    now - lastRoundChangeRef.current > STALE_BOARD_MS;

  // ── the clock's tick ─────────────────────────────────────────────────────
  const lastTickSecond = useRef<number | null>(null);
  const holdingWin = meterShown && meterPaise > 0n;
  useEffect(() => {
    // Truncated, to match `clockText`. See the note there: these two derive the
    // same second and a disagreement is an audible tick against a still digit.
    const second = Math.floor(displayLeftMs / 1000);
    if (lastTickSecond.current === second) return;
    const first = lastTickSecond.current === null;
    lastTickSecond.current = second;
    // Silenced while the wheel turns and while the clock is frozen on an
    // uncollected win — a tick under a still clock reads as a fault.
    if (!first && !spinning && !frozenAtZero && second > 0) rouletteSounds.timerTick();
  }, [displayLeftMs, spinning, frozenAtZero]);

  // ── staged money ─────────────────────────────────────────────────────────
  const stagedPaise = useMemo(
    () => staged.reduce((a, s) => a + s.paise, 0n),
    [staged],
  );

  /**
   * The Score.
   *
   * `balance − held win − staged`. The held win is subtracted because it is NOT
   * spendable until it is taken: the meter is holding it, and letting a player
   * bet it and then take it as well would show them money twice. A negative
   * intermediate draws 0 rather than a minus sign.
   */
  const scoreRawPaise =
    balancePaise === null
      ? null
      : balancePaise - (meterShown ? meterPaise : 0n) - stagedPaise;
  /**
   * The DISPLAYED score, floored at zero.
   *
   * The floor is for the meter and nothing else — a minus sign on a Score is
   * not a state this cabinet has. Every arithmetic check reads
   * `scoreRawPaise`, because a floored value cannot tell "exactly nothing
   * left" from "overdrawn" and that is the only distinction an affordability
   * check is making.
   */
  const scorePaise = scoreRawPaise === null || scoreRawPaise > 0n ? scoreRawPaise : 0n;

  // ── the round boundary ───────────────────────────────────────────────────
  const finishRef = useRef<() => void>(() => undefined);
  /**
   * The meter as it stands RIGHT NOW, not as it stood at the last render.
   *
   * `finishRef.current()` lands an in-flight drain and clears the frozen flag,
   * and the line below then decides whether to put it back. Reading the state
   * variables there read the values from before the drain landed — during a
   * drain those are a shown meter with money still in it — so the flag went
   * straight back on. Both places that clear it are guarded on the take being
   * in progress, which by then it is not, so it never cleared again for the
   * life of the mount: the clock read 0:00 for ever, the status line asked for
   * a take that was not there, and the spin fired at disclosure instead of at
   * clock zero, which could play the losing sting on a winning round.
   */
  /**
   * The idempotency key for the placement in flight.
   *
   * Minted when a confirm starts and kept until that confirm SUCCEEDS, so a
   * retry after an ambiguous partner-wallet failure collapses into the same
   * bet rather than debiting the partner twice. A new layout mints a new key,
   * because it is a different bet — the server refuses a key reused for a
   * different game or round rather than silently returning the old slip.
   */
  const placementKeyRef = useRef("");

  const meterRef = useRef({ shown: meterShown, paise: meterPaise });
  meterRef.current = { shown: meterShown, paise: meterPaise };

  const onRoundOpen = useCallback(() => {
    // A drain caught by a new round lands at once, silently.
    finishRef.current();
    setAutoSent(false);
    setReachedMinimum(false);
    setBetPlaced(false);
    setOfferPrevBet(betThisRound);
    setBetThisRound(false);
    setStaged([]);
    setRemoving(false);
    // A win still uncollected pins the clock at zero and stops rounds being
    // shown at all until it is taken. Read after the drain landed, so a take
    // that was still running when the round turned over does not re-freeze.
    const m = meterRef.current;
    setFrozenAtZero((f) => f || (m.shown && m.paise > 0n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betThisRound]);

  // Betting closing: fold the panel and discard whatever was never confirmed.
  const closedRef = useRef<string | null>(null);
  useEffect(() => {
    // `phase === null` is NOT "closed" — it is the render before the snapshot
    // has seeded the live state. Treating it as closed captured an EMPTY
    // layout as the round's `pending` facts on every mount, and the chart then
    // drew that empty layout instead of the chips the player was staging:
    // no pills, for the whole round, on a fresh page.
    if (!snap || round.phase === null || round.phase === "betting") return;
    if (snap.roundId !== round.roundId) return;
    if (closedRef.current === snap.roundId) return;
    closedRef.current = snap.roundId;

    // Capture this round's facts BEFORE the next round wipes the bet list:
    // the reveal happens after that wipe, and the chart has to keep showing
    // the layout the wheel is spinning for.
    //
    // From the SERVER'S accepted bets and nothing else. This used to prefer
    // the staged chips, so a layout the player never confirmed — or one the
    // server refused — stayed on the table through the whole spin, looking
    // for all the world like money riding on the round. Staged chips die
    // here, with the toast below; what the wheel spins for is what the server
    // has.
    setPending({
      roundId: snap.roundId,
      staked: snap.myBets.length > 0,
      stakes: stakesFromMyBets(snap.myBets),
      totalPaise: snap.myBets.reduce((a, b) => a + BigInt(b.totalStake), 0n),
    });
    setPanelOpen(false);
    setRemoving(false);
    // A layout still IN FLIGHT (confirmed, no answer yet) is not unconfirmed:
    // the retry loop owns it, and the server answers a complete retry with
    // the slip even after the close. Only chips nobody confirmed die here —
    // SILENTLY (third edition, fourth pass): the notice held the line for
    // four seconds to say what the empty felt already says, and the line
    // reads `Bet Time Over.` on its own.
    if (staged.length > 0 && !betPlaced) setStaged([]);
    // The LAST round's winner cell stops blinking when this window shuts —
    // unless a win is still waiting, in which case it blinks until TAKE. It
    // used to clear only when the panel opened, so a spectator, or a player
    // who lost and sat out, watched a cell blink for ever.
    if (!(meterShown && meterPaise > 0n)) {
      setFlashPocket(null);
      setCelebrating(false);
      setLost(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, round.phase, staged, betPlaced, toast]);

  // A bet confirmed in the closing second can reach the snapshot AFTER the
  // capture above ran with an empty list. While the snapshot still belongs to
  // that round, a later one that carries bets refreshes the captured layout.
  useEffect(() => {
    if (!snap || !pending || snap.roundId !== pending.roundId) return;
    if (pending.stakes.length > 0 || snap.myBets.length === 0) return;
    setPending({
      roundId: snap.roundId,
      staked: true,
      stakes: stakesFromMyBets(snap.myBets),
      totalPaise: snap.myBets.reduce((a, b) => a + BigInt(b.totalStake), 0n),
    });
  }, [snap, pending]);

  /**
   * The one-confirm lock is RE-ARMED from the server's own bet list.
   *
   * It was plain state, set on send and cleared at the next round, so it lived
   * only as long as the tab: reload inside the betting window — or open the
   * game on a second device — and the lock was gone, the panel opened, and a
   * SECOND slip went onto a round already bet. The player even saw their first
   * layout drawn from `myBets` while adding to it.
   *
   * "This round has a slip of mine" is the whole rule, and the snapshot already
   * carries the answer. Refunded slips do not count: that stake came back, so
   * the round is genuinely unbet.
   */
  useEffect(() => {
    if (!snap || round.roundId === null || snap.roundId !== round.roundId) return;
    if (!snap.myBets.some((b) => b.status !== "refunded")) return;
    setBetPlaced(true);
    setBetThisRound(true);
  }, [snap, round.roundId]);

  // There is NO per-position floor (operator decision, 2026-09-14): the table
  // minimum judges the staged TOTAL, so ₹5 spread across five spots is a
  // legal ₹5 bet and Bet Ok offers it. A per-position floor check used to
  // refuse exactly that.

  // The deadline sends the layout itself, so a player who staged and looked
  // away is not silently dropped from the round they thought they were in.
  //
  // Only a layout the confirm would take: a short one (under the table
  // minimum, or under our own floor) is not auto-sent at all, so the deadline
  // never toasts a minimum at a player who did not press anything (third
  // edition, fourth pass). It dies silently with the window.
  useEffect(() => {
    if (!acceptsBets || staged.length === 0 || autoSent || betPlaced) return;
    if (bettingLeftMs > AUTO_SEND_AT_MS) return;
    if (stagedPaise < minStakePaiseOf(configQuery.data)) return;
    setAutoSent(true);
    // The same `confirmBets` the button runs: racing the player's own Bet Ok
    // is safe because both carry the key the chips were staged with.
    void confirmBets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bettingLeftMs, acceptsBets, staged.length, autoSent, betPlaced, stagedPaise]);

  // The latch: set on every change to the staged layout, never cleared by one.
  useEffect(() => {
    if (staged.length > 0 && stagedPaise >= minStakePaiseOf(configQuery.data)) {
      setReachedMinimum(true);
    }
  }, [staged.length, stagedPaise, configQuery.data]);

  /**
   * A round whose spin was dropped because a win was still on the meter.
   *
   * `revealedRoundId` is "the round whose result the player has seen", and
   * three separate reads key off it: which chips the chart draws
   * (`stakesShown`), what Total Bet reads, and whether Prev Bet is offered.
   * Left behind by a dropped spin, all three described the round BEFORE it —
   * so after TAKE the player saw the previous layout, a Total Bet of 0 and no
   * sign of the chips they were staging, for the whole of the next round, and
   * the dropped round never joined the history strip.
   *
   * Advanced WITHOUT the reveal's other half: no flash, no win or lose sting,
   * no celebration. Nothing was shown, and a sting for a spin the player never
   * watched is a lie about what happened. A win on the dropped round is still
   * on the server's meter and surfaces through the "win already waiting"
   * effect below, which is what that effect is for.
   */
  const onResultSkipped = useCallback(
    (roundId: string) => {
      setRevealedRoundId(roundId);
      void qc.invalidateQueries({ queryKey: [wheel.code, "pockets"] });
    },
    [qc, wheel.code],
  );

  // ── the reveal ───────────────────────────────────────────────────────────
  const onResultShown = useCallback(
    (pocket: number, roundId: string) => {
      setRevealedRoundId(roundId);
      setFlashPocket(pocket);
      void qc.invalidateQueries({ queryKey: [wheel.code, "pockets"] });

      const staked = pending?.roundId === roundId ? pending.staked : false;
      /**
       * DECIDED HERE AND NOW, from a value already in hand. No await.
       *
       * The cabinet decides win or lose at the instant the ring stops, from
       * `_pendingWinMinor` — captured BEFORE the spin, held hidden until the
       * reveal (parity spec 08, step 11: "`_celebrating`/`_lost` decided from
       * the CAPTURED `_pendingWinMinor`"). The screen never asks the network
       * at the moment of the reveal, so the text and the sting land on the
       * same frame the ball settles.
       *
       * This used to `await` a meter refetch here, and then — worse — to RETRY
       * that read for several seconds on a partner stream, so the ball came to
       * rest and the player sat looking at a still wheel with no verdict. That
       * was the wrong fix for a real problem: a partner's meter IS armed late,
       * because their win is a credit the dispatcher delivers after
       * settlement. The right place for it is the late-arrival path below,
       * which the spec already defines (step 9: a payout arriving after its
       * own reveal shows at once and plays `win.ogg` there). The reveal stays
       * instant; the late win still celebrates when it lands.
       */
      const won = capturedWinRef.current;
      const paise = won && won.roundId === roundId ? won.paise : 0n;
      if (paise > 0n) {
        setMeterPaise(paise);
        setMeterShown(true);
        setCelebrating(true);
        setLost(false);
        setHeldStakes(won!.stakes);
        rouletteSounds.win();
      } else if (staked) {
        setLost(true);
        setCelebrating(false);
        rouletteSounds.lose();
      } else {
        // A spectator hears the wheel stop and nothing else. A win or lose
        // sting for a round they had no money on is a lie about what
        // happened to them.
        rouletteSounds.wheelEnd();
      }
      // Fire and forget, for the round AFTER this one: never awaited, because
      // nothing on this frame may wait on the network.
      void refetchMeter();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, wheel.code, qc],
  );

  // ── a win already waiting when the screen opens ──────────────────────────
  // The server's meter is the truth about an uncollected win, and a player
  // who left and came back — or reloaded — has one with NO spin coming to
  // reveal it. It shows at once, with the held layout.
  //
  // The one case that must NOT show here is the win of the round the wheel is
  // still about to spin for: `onResultShown` unveils that one when the ball
  // lands, and naming it early would announce the number before the wheel.
  //
  // The clock is NOT frozen here — see below.
  const meterData = meterQuery.data;
  /**
   * The round whose win this screen has already taken. The press clears the
   * server's row, but the query still holds the OLD row until its refetch
   * lands, and in that gap the effect below saw "a win, not shown, not taking"
   * and put the twenty back on the meter the drain had just emptied.
   */
  const takenRoundRef = useRef<string | null>(null);
  /** The held-win greeting fires once per screen, whichever path is first to know. */
  const greetedWinRef = useRef(false);

  /**
   * Park an unrevealed win for the reveal to read, and only that.
   *
   * The effect below SHOWS a win; this one only remembers it. The two are
   * deliberately separate because the spec's step 9 is exactly this split —
   * the value updates while `_winShown` stays false, so the number exists on
   * the client before the ball stops and the reveal owes nothing to the
   * network.
   */
  useEffect(() => {
    const win = meterData?.pendingWin;
    if (!win) return;
    const paise = BigInt(win.amountPaise);
    if (paise <= 0n || !win.roundId) return;
    if (win.roundId === takenRoundRef.current) return;
    capturedWinRef.current = {
      roundId: win.roundId,
      paise,
      stakes: stakesFromSettled(meterData?.layout?.bets ?? []),
    };
  }, [meterData]);

  /**
   * A round the snapshot has already settled as a LOSS needs no polling: every
   * slip of ours is terminal at zero. Keeps the local table at its one read,
   * and a losing partner player at none — only a WIN whose credit is still in
   * flight is worth asking about again.
   */
  const lostForSure =
    pending !== null &&
    snap?.roundId === pending.roundId &&
    snap.myBets.length > 0 &&
    snap.myBets.every((b) => b.status !== "pending" && BigInt(b.payoutAmount ?? "0") === 0n);
  awaitingWinRef.current =
    pending !== null &&
    pending.staked &&
    !lostForSure &&
    revealedRoundId !== pending.roundId &&
    capturedWinRef.current?.roundId !== pending.roundId;

  useEffect(() => {
    if (!meterData?.pendingWin || meterShown || taking) return;
    /**
     * NOT UNTIL THE ROUND HAS ANSWERED.
     *
     * `/win` is a lighter call than the round snapshot and routinely lands
     * first, and every guard below is about the live round — so on re-entry
     * the meter flashed a win up before this screen knew whether that win
     * belonged to the round the wheel was still about to spin for. The amount
     * is seeded either way; what waits is DRAWING it.
     */
    if (!snap) return;
    const paise = BigInt(meterData.pendingWin.amountPaise);
    if (paise <= 0n) return;
    const wonIn = meterData.pendingWin.roundId;
    if (wonIn && wonIn === takenRoundRef.current) return;
    if (wonIn && wonIn === round.roundId) return;
    if (wonIn && pending?.roundId === wonIn && revealedRoundId !== wonIn) return;
    setMeterPaise(paise);
    setMeterShown(true);
    setHeldStakes(stakesFromSettled(meterData.layout?.bets ?? []));
    /**
     * A payout that arrives AFTER its own reveal celebrates HERE.
     *
     * This is the partner case, and the spec puts it in exactly this place:
     * "`win.ogg` plays here only for a payout arriving after its own reveal"
     * (08, step 9). A partner's win is a credit the dispatcher delivers a few
     * seconds after settlement, so the ball can stop before the meter is
     * armed — the reveal correctly says nothing, and the win announces itself
     * when it lands rather than holding the wheel silent waiting for it.
     * `lost` is cleared with it: the round did not lose.
     */
    if (wonIn && wonIn === revealedRoundId) {
      setLost(false);
      setCelebrating(true);
      rouletteSounds.win();
    } else if (wonIn && !greetedWinRef.current) {
      /**
       * ARRIVING to a win nobody has collected (spec 08 §6a.1): won in the
       * lobby, on another device, with the app in the background. There is
       * no spin coming for it, so the wheel cannot announce it and the
       * screen does — the winning cell blinks and `win.ogg` plays ONCE per
       * screen. The round is identified by the meter's own `roundId` against
       * the history; skipped when the history has no such row (the meter
       * still asks to be collected, which is the part that matters, and the
       * number is a courtesy). A win the wheel is about to announce never
       * reaches here — the guards above withhold it.
       */
      greetedWinRef.current = true;
      const row = (snap.recent ?? []).find((r) => r.roundId === wonIn);
      const pocket = (row?.outcome as { pocket?: unknown } | null)?.pocket;
      if (typeof pocket === "number") setFlashPocket(pocket);
      rouletteSounds.win();
    }
    // NOT frozen yet. The clock keeps counting the round that is open and
    // latches at zero when that round ends (`onRoundOpen`), exactly as it does
    // for a win revealed on this screen — the player sees the count reach
    // 0:00 and THEN the hold, never a clock that was stopped on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meterData, meterShown, taking, round.roundId, pending?.roundId, revealedRoundId]);

  /**
   * The LAST RESULT is restored on arrival — the cell flash whatever the
   * outcome, and the `Game over…` line only for a loss the player was in.
   *
   * The flash survives into the next betting window during a session, so it
   * has to survive a reload into that window too; and a loss used to leave no
   * trace at all, which made the two halves asymmetric in the wrong direction
   * (the meter always restored a win).
   *
   * WITH NO SOUND. The player did not watch this spin; a sting for a round
   * they were not present for is a lie about what they just saw.
   *
   * Four guards, all read at ARM time because the fetch sits between mount and
   * here:
   *   - nothing else is already telling a story (a held win, a round captured
   *     and waiting for its reveal, a flash already up);
   *   - the live round is not already being BET ON — a bet placed, the panel
   *     open, chips staged, or a slip of ours on the board. The one-confirm
   *     lock re-arms from `myBets` with no panel-open to clear a flash, so a
   *     flash lit here would sit over a round the player is actively betting;
   *   - the live window has not already shut, since the flash belongs to the
   *     window it was won in;
   *   - and the round still in its own closed tail is never restored. The ball
   *     announces that one, and naming it here would announce it early.
   */
  const restoredRef = useRef(false);
  const lastSettled = useQuery<{ pocket: number; totalStake: string; payoutAmount: string }[]>({
    queryKey: [wheel.code, "recent", 1],
    queryFn: () =>
      customFetch(`/api/${wheel.code}/recent?limit=1`, {
        method: "GET",
        credentials: "include",
      }),
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (restoredRef.current) return;
    const row = lastSettled.data?.[0];
    // Wait for the ROUND too: every guard below reads it, and arming against a
    // snapshot that has not answered is the same mistake as showing a win
    // before it.
    if (!row || !snap) return;
    // The live paths own everything from here on; this is only for arriving
    // cold. Marked done either way, so it can never fire mid-session.
    restoredRef.current = true;
    if (meterShown || pending !== null || flashPocket !== null) return;
    if (meterData?.pendingWin && BigInt(meterData.pendingWin.amountPaise) > 0n) return;
    // Already betting this round, or the window has shut.
    if (betPlaced || panelOpen || staged.length > 0) return;
    if (snap.myBets.some((b) => b.status !== "refunded")) return;
    if (!acceptsBets) return;
    setFlashPocket(row.pocket);
    // The notice is only for a loss the player actually had money on. A
    // spectator's screen says nothing.
    if (BigInt(row.totalStake) > 0n && BigInt(row.payoutAmount) <= 0n) setLost(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSettled.data, snap]);

  // ── TAKE ─────────────────────────────────────────────────────────────────
  const drainTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const drainDelay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finishDrainNow = useCallback(() => {
    if (drainTimer.current) clearInterval(drainTimer.current);
    if (drainDelay.current) clearTimeout(drainDelay.current);
    drainTimer.current = undefined;
    drainDelay.current = undefined;
    if (!taking) return;
    rouletteSounds.drainStop();
    // The ref, not just the state: `onRoundOpen` reads it on the very next line
    // and a setState has not landed by then.
    meterRef.current = { shown: false, paise: 0n };
    setMeterPaise(0n);
    setMeterShown(false);
    setTaking(false);
    setFrozenAtZero(false);
    setHeldStakes(null);
    setFlashPocket(null);
    setCelebrating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taking]);

  // Unmount ONLY. Keyed on `finishDrainNow` this ran its cleanup every time
  // `taking` changed identity — which is the instant the press sets it — and
  // cleared the drain's timers before the first chunk could land. The server
  // had taken the win; the screen sat on the old number for ever.
  finishRef.current = finishDrainNow;
  useEffect(() => () => finishRef.current(), []);

  /**
   * Backgrounding LANDS a running drain, silently.
   *
   * The money was collected at the press, so the drain is only an animation —
   * and a browser throttles a hidden tab's timers to about once a second,
   * which would leave it creeping down for a minute after the player looked
   * away. The cabinet lands it on the same event. Paired with the audio cut on
   * the screen, which is the other half of the same rule.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) finishRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const take = useCallback(() => {
    if (taking || meterPaise <= 0n) return;
    rouletteSounds.take();
    takenRoundRef.current = meterQuery.data?.pendingWin?.roundId ?? null;
    // The parked value goes with it, or a reveal still to come for that round
    // would celebrate a win the player has already collected.
    if (capturedWinRef.current?.roundId === takenRoundRef.current) {
      capturedWinRef.current = null;
    }
    setTaking(true);
    // Reported on the PRESS, not when the drain finishes: the drain is an
    // animation and the player has already decided.
    void customFetch(`/api/${wheel.code}/win/take`, {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ takeKey: crypto.randomUUID() }),
      headers: { "Content-Type": "application/json" },
    })
      .catch(() => undefined)
      .finally(() => {
        void qc.invalidateQueries({ queryKey: WALLET_KEY });
      });

    // 470 ms of dead air first — that is the window the button's own rattle
    // plays in, and starting the count under it makes the two fight.
    drainDelay.current = setTimeout(() => {
      rouletteSounds.drainStart();
      /**
       * The FIRST chunk lands inside this callback, at 470 ms — not on the
       * periodic's first beat at 570 ms.
       *
       * The cabinet's pre-delay callback takes a chunk and then starts the
       * ticker, so the rattle and the first digit change happen together.
       * Starting only the periodic here held the meter on its opening number
       * for an extra 100 ms with the loop already rattling over a still
       * display, and pushed every later digit 100 ms late.
       */
      setMeterPaise((left) => {
        const next = left - chunkOf(left);
        return next <= 0n ? 0n : next;
      });
      drainTimer.current = setInterval(() => {
        // The updater decides the next value and NOTHING else. An updater must
        // be pure — React may call it twice — so the teardown cannot live
        // inside it. Nor can it live immediately after: React only runs an
        // updater synchronously through the eager-state path, which needs the
        // fiber to have no pending work, and this hook keeps three intervals
        // ticking on the same fiber. When it defers, a flag set here has not
        // been written yet. The effect below owns the teardown instead, keyed
        // on the state actually landing.
        setMeterPaise((left) => {
          const next = left - chunkOf(left);
          return next <= 0n ? 0n : next;
        });
      }, TAKE_TICK_MS);
    }, TAKE_PRE_DELAY_MS);
  }, [taking, meterPaise, wheel.code, qc, refetchMeter, meterQuery.data]);

  /**
   * AUTO-TAKE (operator request, 2026-09-26): no win is ever left waiting.
   *
   * The moment a win is on the meter — revealed on this screen, arrived late
   * from a partner wallet, or found waiting on entry — Take lights for ONE
   * blink of the shared beat and is then pressed for the player, through the
   * same `take()` a finger would reach: the press sound, the drain into the
   * Score, and the server row cleared on the press. Taken this way, the hold
   * (`frozenAtZero`, "Please Take the Winning Points.") can no longer be
   * reached in play; it stays as the fallback for a take that did not start.
   * Moves no money — `take()` never did.
   */
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    if (!holdingWin || taking) return;
    const t = setTimeout(() => takeRef.current(), FLASH_MS);
    return () => clearTimeout(t);
  }, [holdingWin, taking]);

  /**
   * The drain has landed: stop it and clear everything it was holding.
   *
   * Keyed on the STATE rather than on the tick that produced it, so it runs
   * whether React applied the updater eagerly or deferred it. This is also the
   * one path that clears the meter when the win was taken somewhere ELSE — a
   * second tab, or a take whose response was lost — because `meterPaise`
   * arrives at zero from the refetch just the same.
   */
  useEffect(() => {
    if (!taking || meterPaise > 0n) return;
    /**
     * ONE more beat with the meter reading zero before everything is torn
     * down.
     *
     * The cabinet's periodic fires once more after the last chunk and the
     * player sees `0` for a full 100 ms; tearing down the instant the state
     * hit zero meant the meter went straight from its last value to hidden and
     * the zero was never on screen. The wait is the same beat as the drain, so
     * the whole press-to-done span is unchanged.
     */
    const done = setTimeout(() => {
      if (drainTimer.current) clearInterval(drainTimer.current);
      drainTimer.current = undefined;
      rouletteSounds.drainStop();
      meterRef.current = { shown: false, paise: 0n };
      setTaking(false);
      setMeterShown(false);
      setFrozenAtZero(false);
      setHeldStakes(null);
      setFlashPocket(null);
      setCelebrating(false);
      void refetchMeter();
    }, TAKE_TICK_MS);
    return () => clearTimeout(done);
  }, [taking, meterPaise, refetchMeter]);

  /**
   * The server says there is no win waiting, so nothing may still be shown.
   *
   * The meter was only ever SET from the server and cleared from `take()`, so
   * a second tab that watched the first take the win kept its meter for ever:
   * betting blocked, the clock pinned at 0:00, the status line asking for a
   * take that was already made, and Score understated by the whole win.
   */
  useEffect(() => {
    if (taking) return;
    if (meterQuery.data === undefined) return;
    const pending = meterQuery.data?.pendingWin ?? null;
    if (pending && BigInt(pending.amountPaise) > 0n) return;
    if (!meterShown && meterPaise === 0n) return;
    meterRef.current = { shown: false, paise: 0n };
    setMeterPaise(0n);
    setMeterShown(false);
    setFrozenAtZero(false);
    setHeldStakes(null);
  }, [meterQuery.data, taking, meterShown, meterPaise]);

  // ── staging ──────────────────────────────────────────────────────────────
  // `(panelOpen || betsWhereItSits)` is the toggle's half; every other term
  // is unchanged by it — turning the zoom off does not buy a player a bet
  // they could not otherwise place (spec 08 §6b.3).
  //
  // `!stale` is the cabinet's `online` term (17 §0.3, Z-04): a board that has
  // stopped updating must not take chips it cannot send. Bet Ok already
  // refused through `canConfirm`; the chart itself did not.
  const accepting =
    (panelOpen || betsWhereItSits) && acceptsBets && !stale && !spinning && !holdingWin && !betPlaced;

  const stakeBet = useCallback(
    (type: BetType, selection: number[]): boolean => {
      if (!accepting) return false;
      const amount = BigInt(chip) * PAISE_PER_POINT;
      if (scoreRawPaise !== null && amount > scoreRawPaise) {
        toast("Score Insufficient.");
        return false;
      }
      const limits = configQuery.data?.limits;
      const band = limits ? limits[limitGroupOf(type)] : undefined;
      if (band) {
        // Keyed and counted exactly as the SERVER does it, or this optimistic
        // check refuses layouts the server would take and — worse — accepts
        // ones it will not: per POSITION (`type` plus the sorted selection —
        // positions do not pool, whatever they cover), and counting what this
        // player already has ACCEPTED on the round, not just what is staged.
        // Refused at STAGING so the player is stopped at the chip that breaks
        // it rather than losing the whole layout to a refused batch.
        const key = spotKey(type, selection);
        const already =
          staged
            .filter((s) => spotKey(s.type, s.selection) === key)
            .reduce((a, s) => a + s.paise, 0n) +
          (placedByPosition.get(key) ?? 0n);
        const after = already + amount;
        if (after > BigInt(Math.round(band.max * 100))) {
          // Names the bet TYPE, not the selection: the player did not choose a
          // selection, they put a chip on a spot (parity spec 09 §refusals).
          toast(`Up to ${band.max} on one ${type}.`);
          return false;
        }
      }
      // The slip cap the server enforces, honoured HERE too. It was served on
      // the config and read by nothing, so a player could stage past it, get a
      // live Bet Ok, and be refused at confirm — and if the deadline auto-send
      // was what hit the refusal, the flag stayed set and the whole layout was
      // discarded in silence. A NEW position is what counts; topping up one
      // already on the table adds no chip to the slip.
      const cap = configQuery.data?.maxBetsPerSlip ?? Infinity;
      const isNewPosition = !staged.some(
        (st) => stakeKey(st.type, st.selection) === stakeKey(type, selection),
      );
      if (isNewPosition && staged.length >= cap) {
        // NOT "confirm this one first": confirming locks the chart for the
        // rest of the round, so that instruction could not be followed. The
        // cap is per ROUND here, whatever the server calls it.
        toast(`Up to ${cap} positions in one round.`);
        return false;
      }
      rouletteSounds.bet();
      justStakedRef.current = { type, selection };
      setStaged((prev) => {
        const key = stakeKey(type, selection);
        const idx = prev.findIndex((s) => stakeKey(s.type, s.selection) === key);
        if (idx < 0) return [...prev, { type, selection, paise: amount }];
        // A repeat tap MERGES into the position's existing chip. Two pills on
        // one number would hide the number under them.
        const next = [...prev];
        next[idx] = { ...next[idx]!, paise: next[idx]!.paise + amount };
        return next;
      });
      return true;
    },
    [accepting, chip, scoreRawPaise, staged, configQuery.data, toast, placedByPosition],
  );

  /**
   * Take the ENTIRE staged amount off one spot. Returns whether there was one:
   * a tap on an EMPTY spot while armed RETIRES the mode and places a chip
   * instead of being swallowed (09 §6b.4) — reaching for an empty spot is a
   * player going back to betting, and swallowing that tap left them tapping
   * at a board that had stopped answering.
   */
  const removeStake = useCallback((type: BetType, selection: number[]): boolean => {
    const key = stakeKey(type, selection);
    justStakedRef.current = null;
    const had = stagedRef.current.some((s) => stakeKey(s.type, s.selection) === key);
    if (!had) {
      setRemoving(false);
      return false;
    }
    setStaged((prev) => {
      const next = prev.filter((s) => stakeKey(s.type, s.selection) !== key);
      // The mode disarms when the table is empty: leaving it armed means the
      // next tap after clearing the board silently does nothing.
      if (next.length === 0) setRemoving(false);
      return next;
    });
    return true;
  }, []);

  const clearStaged = useCallback(() => {
    setStaged([]);
    setRemoving(false);
    setPanelOpen(false);
  }, []);

  /**
   * Cancel Specific: arming ALSO takes the last chip off, at once.
   *
   * Making the player arm the mode and then find the spot again is two taps
   * for the thing they had already pointed at. The mode stays armed for the
   * next one; pressing again disarms. `justStaked` is consumed by the arming
   * press whether or not that chip is still on the table, so arm → disarm →
   * arm peels nothing — the second press is not about a chip the player just
   * put down, because they have not put one down since.
   */
  const toggleRemoving = useCallback(() => {
    if (removing) {
      setRemoving(false);
      return;
    }
    const last = justStakedRef.current;
    justStakedRef.current = null;
    setRemoving(true);
    if (last) removeStake(last.type, last.selection);
  }, [removing, removeStake]);

  // ── confirm ──────────────────────────────────────────────────────────────
  /** The round the socket is on RIGHT NOW, for the retry loop to read after an await. */
  const roundIdRef = useRef<string | null>(null);
  roundIdRef.current = round.roundId;

  /**
   * Bet Ok, in the cabinet's order: window → minimum → geometry → per-position
   * ceiling → affordability, then ONE placement (parity spec 09 §Confirm).
   *
   * The geometry step exists because a placement is all-or-nothing: one chip
   * the server refuses places nothing at all, so a single bad selection would
   * make the whole board vanish with one message about a bet the player cannot
   * see. Nothing on the screen can currently produce one, which is what makes
   * it worth having — the day something does, the player is told which chip.
   */
  const confirmBets = useCallback(async () => {
    if (staged.length === 0) return;
    if (!acceptsBets) {
      toast("Bet time over — not placed");
      return;
    }
    const minPaise = minStakePaiseOf(configQuery.data);
    if (stagedPaise < minPaise) {
      toast(`Minimum bet is ${wholePoints(minPaise)}`);
      return;
    }
    for (const c of staged) {
      if (coveredPockets(wheel, c.type, c.selection).length === 0) {
        toast(`That ${c.type} cannot be placed here.`);
        return;
      }
    }
    // The ceiling again, as a BACKSTOP: staging judged it chip by chip, but an
    // accepted bet counts too and one can be acked between the last chip going
    // down and the press.
    const limits = configQuery.data?.limits;
    if (limits) {
      const byPosition = new Map<string, { type: BetType; paise: bigint }>();
      for (const c of staged) {
        const k = spotKey(c.type, c.selection);
        const cur = byPosition.get(k);
        byPosition.set(k, { type: c.type, paise: (cur?.paise ?? 0n) + c.paise });
      }
      for (const [k, pos] of byPosition) {
        const band = limits[limitGroupOf(pos.type)];
        const total = pos.paise + (placedByPosition.get(k) ?? 0n);
        if (band && total > BigInt(Math.round(band.max * 100))) {
          toast(`Up to ${band.max} on one ${pos.type}.`);
          return;
        }
      }
    }
    // `scorePaise` ALREADY has the staged total subtracted, so the affordable
    // test is "is the score still non-negative", not "is the stake under the
    // score" — the latter compares the stake against a number it is already
    // inside, and is true for any stake at all. Staging refuses an unaffordable
    // chip one at a time; this is the backstop for the balance moving between
    // staging and confirming.
    if (scoreRawPaise !== null && scoreRawPaise < 0n) {
      toast("Score Insufficient.");
      return;
    }
    const roundAtSend = roundIdRef.current;
    const body = {
      bets: staged.map((s) => ({
        type: s.type,
        selection: s.selection,
        amountPaise: s.paise.toString(),
      })),
      // Named so a replay of this key on a LATER round is refused rather than
      // answered with this round's slip.
      ...(roundAtSend ? { roundId: roundAtSend } : {}),
      pricingVersion: round.config?.pricingVersion,
    };
    // The lock goes on BEFORE the request, not after it: a slow network is
    // exactly when a player taps Bet Ok twice.
    setBetPlaced(true);
    setBetThisRound(true);
    // The line belongs to the acceptance from here; without this the confirm
    // line outranks `Your Bet Has Been Accepted.` and it is never seen.
    setReachedMinimum(false);
    lastBetsRef.current = staged;
    justStakedRef.current = null;
    setPanelOpen(false);

    // One key per confirmed layout, minted here and cleared on success.
    if (!placementKeyRef.current) {
      placementKeyRef.current = `${wheel.code}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    }

    try {
      /**
       * RE-SENT UNTIL THE SERVER ANSWERS, same key, every `BATCH_ACK_TIMEOUT_MS`
       * (parity spec 09 §"Resent until the server answers").
       *
       * A request that got no answer at all — the network dropped it, a
       * gateway answered for a server it could not reach — used to leave the
       * chips pending until the close wiped them, with whether they were on
       * the round decided by a packet that never came. That cuts both ways: a
       * lost acceptance shows a layout the player turns out to have, a lost
       * refusal one they never did. The key makes a duplicate free, and the
       * server answers a complete retry with the ORIGINAL slip even after the
       * window has shut — so there is no lock-time workaround here either.
       * Bounded by the round, not by a count: a new round retires the batch.
       */
      for (;;) {
        try {
          await customFetch(`/api/${wheel.code}/place`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              // One key per confirmed layout. A retry of THIS placement
              // collapses into the same bet server-side; a different layout
              // gets a different key and is a different bet.
              "Idempotency-Key": placementKeyRef.current,
            },
            body: JSON.stringify(body),
          });
          break;
        } catch (err) {
          if (!isNoAnswer(err)) throw err;
          await new Promise((r) => setTimeout(r, BATCH_ACK_TIMEOUT_MS));
          if (roundIdRef.current !== roundAtSend) {
            // Retired: the round moved on with no answer. The chips die with
            // it, the way the close already discards an unconfirmed layout,
            // and the key with them — the next round is a different bet.
            placementKeyRef.current = "";
            setStaged([]);
            return;
          }
        }
      }
      // Accepted: the next layout is a different bet and needs its own key.
      placementKeyRef.current = "";
      // The staged chips are cleared only once the SERVER's copy is in hand.
      // Cleared first, the chart fell through to `snap.myBets` — which does not
      // hold the new slip yet — so every chip vanished for the length of the
      // round-trip and then reappeared, on a confirm that had just succeeded.
      //
      // Its own catch, and NOT the block below: the bet is placed by now, so a
      // failed refetch must never reach the refusal path — that one re-arms
      // Bet Ok and mints a fresh idempotency key, which would let the next tap
      // place the same layout a second time.
      //
      // The WALLET is awaited alongside the round, and the staged chips are
      // cleared only once BOTH have landed. `Score = balance − meter − staged`,
      // so clearing first while the balance was still the pre-debit number made
      // the Score jump UP by the whole stake and fall back a round-trip later —
      // and in that window the affordability check was measuring money already
      // spent. The cabinet has no such gap because its ack carries the new
      // balance in the same message that clears the chips.
      await Promise.all([
        round.refetch().catch(() => undefined),
        qc.invalidateQueries({ queryKey: WALLET_KEY }).catch(() => undefined),
      ]);
      setStaged([]);
    } catch (err) {
      // A REFUSAL means nothing went on and the round may be bet again. An
      // AMBIGUOUS failure does not, and the two must not be treated alike.
      //
      // On a partner table the stake leaves the partner's wallet, and the
      // server reports a timeout or an unreadable reply as "the debit may or
      // may not have landed" — there is no cancel operation to undo it with.
      // Re-arming the button there invited a second tap that took the stake
      // again. The placement now carries an idempotency key, so an honest
      // retry collapses into the same bet server-side; the chips are still
      // cleared here so the player is not looking at a layout they may already
      // have bought.
      if (isAmbiguousPlacement(err)) {
        setStaged([]);
        toast(messageOf(err));
        return;
      }
      setBetPlaced(false);
      setBetThisRound(false);
      // A refused batch is all-or-nothing and its chips LEAVE the table and
      // the totals (16 §4, E-07): the cabinet flips every chip to `rejected`
      // and draws none of them. They used to stay staged here so the player
      // could adjust and resend, which is kinder and is not the cabinet —
      // the one message on the status line is the whole account of it.
      setStaged([]);
      setRemoving(false);
      // Prev Bet offers the last layout PLACED, not the last one sent: a
      // refusal left it offering to replay chips that never went on, in a
      // round the player had not actually bet in. Cleared outright rather than
      // falling back to an older layout — the offer lasts one round, so a
      // round nobody bet in is a round that offers nothing.
      lastBetsRef.current = [];
      // A REFUSAL took nothing, so the next attempt is a fresh bet. That
      // includes PRIOR_PLACEMENT_VOIDED, which is the server saying this key's
      // earlier attempt is dead — holding the key would refuse every tap for
      // the rest of the session.
      placementKeyRef.current = "";
      toast(refusalLine(err));
      // A refusal is the one moment we KNOW the client and the server disagree
      // about the balance — the server refused on a number we do not have — so
      // it is the worst place to keep the stale one. Every other terminal path
      // re-reads the wallet; this was the only one that did not.
      void qc.invalidateQueries({ queryKey: WALLET_KEY });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, acceptsBets, stagedPaise, scoreRawPaise, configQuery.data, wheel, qc, toast, placedByPosition]);

  /** Prev Bet: re-stage the last confirmed layout. Staged, NOT sent. */
  const prevBet = useCallback(() => {
    const last = lastBetsRef.current;
    if (last.length === 0) return;
    const total = last.reduce((a, s) => a + s.paise, 0n);
    // Nothing is staged when Prev Bet is offered, so the score here IS the
    // spendable balance and the comparison is the straightforward one.
    if (scoreRawPaise !== null && total > scoreRawPaise) {
      toast("Score Insufficient.");
      return;
    }
    rouletteSounds.bet();
    justStakedRef.current = null;
    setStaged(last);
    // Offered once per round: clearing the table afterwards is the player
    // editing their own layout, not a reason to blink the offer again.
    setOfferPrevBet(false);
    // The panel stays SHUT. Prev Bet puts the last layout back on the table
    // as it stands and leaves Bet Ok blinking for the confirm — opening the
    // tray and moving everything about for a layout the player has already
    // chosen once is the wrong gesture. A chart tap still opens it to add.
    setFlashPocket(null);
    setCelebrating(false);
    setLost(false);
  }, [scoreRawPaise, toast]);

  const openPanel = useCallback(() => {
    // With Wheel Zoom off there is no expansion to run: the panel never
    // opens and the chart, chips and buttons stay at their closed rects for
    // the whole round. Every other guard still applies on top.
    if (betsWhereItSits) return;
    if (!acceptsBets || holdingWin || betPlaced || spinning) return;
    setPanelOpen(true);
  }, [betsWhereItSits, acceptsBets, holdingWin, betPlaced, spinning]);

  /**
   * The toggle itself. Dead while the wheel runs (spec 08 §6b.6 — REVERSED
   * from the second edition, which had it as the one live control mid-spin:
   * in the hand it read as the wheel lurching in and out under a spin nobody
   * can stop). Flipping it OFF folds an open panel through the ordinary
   * collapse and KEEPS the staged chips — a change of how much room the table
   * has, not of what is on it; flipping it back ON does not re-open it.
   */
  const toggleZoom = useCallback(() => {
    if (spinning) return;
    const next = !zoomOn;
    setWheelZoom(next);
    if (!next) {
      setPanelOpen(false);
      setRemoving(false);
    }
  }, [spinning, zoomOn]);

  // The last round's winning cell stops blinking the moment the player
  // engages with the next one — on EVERY way the panel opens, not only the
  // chart tap. Prev Bet opened it too and left the cell blinking under a
  // freshly placed layout, which is what "still flashes after I bet" was.
  useEffect(() => {
    if (!panelOpen) return;
    setFlashPocket(null);
    setCelebrating(false);
    setLost(false);
  }, [panelOpen]);

  /**
   * Coming back after a short absence: the round, the wallet and the history
   * strip (only refreshed when a result is SHOWN, and nothing was shown while
   * there were no frames to show it in) are re-read; the meter's "win already
   * waiting" effect does the rest.
   */
  const catchUp = useCallback(() => {
    void round.refetch().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: WALLET_KEY });
    void qc.invalidateQueries({ queryKey: [wheel.code, "pockets"] });
    void refetchMeter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, wheel.code, refetchMeter]);

  const selectChip = useCallback((c: ChipValue) => {
    setChip(c);
    rouletteSounds.chipSelect();
  }, []);

  // ── what the chart draws ─────────────────────────────────────────────────
  /**
   * Rounds overlap on screen and the table answers for two of them at once:
   * the wheel is still turning through the first seconds of the NEXT window,
   * and an uncollected win holds its own table. The order (spec 08 §6a):
   *
   *   1. the LIVE round's stakes, whenever there is anything of them to show
   *      — chips being staged, or a slip of ours the snapshot already holds;
   *   2. else the layout a held, uncollected win was won on;
   *   3. else the layout captured at the lock, while its reveal is pending;
   *   4. else nothing.
   *
   * The live round winning is the load-bearing part and was a real bug: held
   * and pending belong to a PAST round, so a player who bet — by hand or with
   * Prev Bet — while the old wheel was still turning watched the old layout
   * sit there while their own chips went down invisibly. The Bet meter
   * follows the same order, so the figure never describes a round the table
   * is no longer showing.
   */
  const liveStakes: Stake[] = useMemo(() => {
    if (staged.length > 0) return stakesFromStaged(staged);
    return snapIsCurrent ? stakesFromMyBets(snap?.myBets ?? []) : [];
  }, [staged, snap, snapIsCurrent]);
  const stakesShown: Stake[] = useMemo(() => {
    if (liveStakes.length > 0) return liveStakes;
    if (heldStakes) return heldStakes;
    if (pending && revealedRoundId !== pending.roundId) return pending.stakes;
    return [];
  }, [liveStakes, heldStakes, pending, revealedRoundId]);

  const totalBetPaise = useMemo(() => {
    if (liveStakes.length > 0) {
      return staged.length > 0
        ? stagedPaise
        : (snap?.myBets ?? [])
            .filter((b) => b.status !== "refunded")
            .reduce((a, b) => a + BigInt(b.totalStake), 0n);
    }
    if (heldStakes) return heldStakes.reduce((a, s) => a + BigInt(s.points) * PAISE_PER_POINT, 0n);
    if (pending && revealedRoundId !== pending.roundId) return pending.totalPaise;
    return 0n;
  }, [liveStakes, heldStakes, pending, revealedRoundId, staged, stagedPaise, snap]);

  /**
   * The last five results.
   *
   * The round awaiting reveal is WITHHELD: printing it here would name the
   * number before the wheel has shown it, which is the whole reason the strip
   * refreshes at the reveal rather than at settlement.
   */
  const history = useMemo(() => {
    // The one round the strip must NOT print: the one the wheel has not shown
    // yet. Printing it here would name the number before the ball lands, which
    // is the whole reason the strip refreshes at the reveal rather than at
    // settlement.
    const withheld =
      pending && revealedRoundId !== pending.roundId ? pending.roundId : null;
    return (snap?.recent ?? [])
      .filter((r) => r.roundId !== withheld)
      .map((r) => (r.outcome as { pocket?: number } | null)?.pocket)
      .filter((p): p is number => typeof p === "number")
      // `recent` arrives NEWEST FIRST. The strip reads oldest to newest, left
      // to right, so it is taken from the front and then turned round.
      .slice(0, 5)
      .reverse();
  }, [snap, pending, revealedRoundId]);

  /** The ball parks on the last settled number, never on 0. */
  const restingPocket = history.length > 0 ? history[history.length - 1]! : 0;

  return {
    round,
    config: configQuery.data ?? null,
    // clocks
    // The clock RUNS through the spin. The wheel turns into the next round's
    // window and the next round's count is what the player sees over it; only
    // the tick SOUND is silenced while the ring moves (see the tick effect).
    // Pinning it at zero for the spin was tried and read as the clock having
    // stopped. It is pinned only while a win is waiting to be taken.
    displayLeftMs: frozenAtZero ? 0 : displayLeftMs,
    // The round's own betting window, so the spin sequence can be sized to fit
    // INSIDE it rather than eating it whole.
    bettingWindowMs: round.config?.bettingWindowMs ?? null,
    bettingLeftMs,
    tailMs,
    lastSeconds,
    frozenAtZero,
    /** No board yet — a cold or waking stream, which is normal on a partner table. */
    waiting,
    /** The board has stopped updating. This one IS a connection problem. */
    stale,
    // blinks
    flashOn,
    barFlashOn,
    // money
    scorePaise,
    meterPaise,
    meterShown,
    totalBetPaise,
    // state
    chip,
    selectChip,
    staged,
    stagedPaise,
    stakesShown,
    panelOpen,
    setPanelOpen,
    openPanel,
    accepting,
    acceptsBets,
    betPlaced,
    autoSent,
    reachedMinimum,
    /** The wheel has already spoken about the round the socket is on. */
    judged: revealedRoundId !== null && revealedRoundId === round.roundId,
    removing,
    setRemoving,
    toggleRemoving,
    notice,
    zoomOn,
    toggleZoom,
    spinning,
    setSpinning,
    holdingWin,
    taking,
    celebrating,
    lost,
    flashPocket,
    history,
    restingPocket,
    offerPrevBet:
      offerPrevBet &&
      staged.length === 0 &&
      !betPlaced &&
      acceptsBets &&
      !stale &&
      !holdingWin &&
      revealedRoundId === pending?.roundId,
    // actions
    stakeBet,
    removeStake,
    clearStaged,
    confirmBets,
    prevBet,
    take,
    onResultShown,
    onResultSkipped,
    catchUp,
  };
}

/**
 * A blink: lit or dark, phase DERIVED from elapsed time on the frame pump
 * (parity spec 06, third edition — the cabinet's `Blink`, a `Ticker`-driven
 * `ValueNotifier<bool>`).
 *
 * Not a toggling interval. A wall-clock timer turned the beat between frames,
 * and the flash visibly stuttered whenever the clock's own once-a-second tick
 * landed in the same gap — two periodic timers competing for one frame. On the
 * frame pump a turn is applied AS part of a frame, and with the phase computed
 * as `floor(elapsed / half) % 2` a frame the browser skipped cannot put it out
 * of step. Starts LIT — the first half is always a whole one — and stops
 * entirely when not wanted, so a blink nobody can see costs nothing.
 */
function useBlink(wanted: boolean, halfMs: number): boolean {
  const [lit, setLit] = useState(true);
  useEffect(() => {
    setLit(true);
    if (!wanted) return;
    const started = performance.now();
    let raf = 0;
    let last = true;
    const frame = (now: number) => {
      const on = Math.floor((now - started) / halfMs) % 2 === 0;
      if (on !== last) {
        last = on;
        setLit(on);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [wanted, halfMs]);
  return lit;
}

// ---------------------------------------------------------------------------

/**
 * How much comes off the meter this tick: a third of what is left, largest
 * first, with three or less landing in one go.
 *
 * The CADENCE is fixed and the CHUNK COUNT grows with the amount, which is the
 * opposite of normalising the duration. A big win therefore takes visibly
 * longer to count out than a small one — that is the point, and evening them
 * out reads as a different machine.
 */
function chunkOf(leftPaise: bigint): bigint {
  const points = leftPaise / PAISE_PER_POINT;
  if (points <= 3n) return leftPaise;
  const chunk = points / 3n;
  return (chunk < 1n ? 1n : chunk) * PAISE_PER_POINT;
}

/**
 * The identity of a POSITION, keyed exactly as the server keys it: the bet
 * type plus the SORTED selection — the cabinet's `spotKey`. Sorted because
 * `split [17,20]` and `split [20,17]` are one spot on the felt. It used to be
 * the covered pockets, which merged the mini wheel's dozen and six line into
 * one position; the third-edition spec is explicit that positions do not pool.
 */
export function spotKey(type: BetType, selection: readonly number[]): string {
  return `${type}:${[...selection].sort((a, b) => a - b).join(",")}`;
}

function stakesFromStaged(staged: StagedChip[]): Stake[] {
  return staged.map((s) => ({
    type: s.type,
    selection: s.selection,
    points: wholePoints(s.paise),
  }));
}

/**
 * The player's chips, from the slips the server accepted.
 *
 * REFUNDED slips are skipped, and that is the point. The snapshot returns every
 * slip whatever its status, and reading them all drew money the player had
 * already been given back: a bet placed in the closing fraction of the window
 * is refunded with a "not placed" toast, and its chips then sat on the table
 * through the whole spin with the total showing, and the reveal played the
 * losing sting for a stake that no longer existed. The path that delivers it is
 * the refresh built for genuinely late bets, which cannot otherwise tell an
 * accepted late slip from a refunded one.
 *
 * Anything not yet terminal counts. A slip is `pending` while the round runs
 * and `settled` afterwards, and both are money that was really on the table.
 */
function stakesFromMyBets(myBets: { bets: unknown; status?: string }[]): Stake[] {
  const out: Stake[] = [];
  for (const slip of myBets) {
    if (slip.status === "refunded") continue;
    if (!Array.isArray(slip.bets)) continue;
    for (const raw of slip.bets as SettledBet[]) {
      out.push({
        type: raw.type,
        selection: Array.isArray(raw.selection) ? raw.selection : [],
        points: wholePoints(BigInt(raw.amountPaise ?? "0")),
      });
    }
  }
  return out;
}

function stakesFromSettled(bets: SettledBet[]): Stake[] {
  return bets.map((b) => ({
    type: b.type,
    selection: Array.isArray(b.selection) ? b.selection : [],
    points: wholePoints(BigInt(b.amountPaise ?? "0")),
  }));
}

/** Which limit band a bet type is judged under. Mirrors the server's grouping. */
function limitGroupOf(type: BetType): string {
  switch (type) {
    case "straight":
      return "number";
    case "split":
    case "street":
    case "corner":
      return "bracket";
    case "sixline":
      return "line";
    case "red":
    case "black":
      return "redBlack";
    case "odd":
    case "even":
      return "oddEven";
    case "low":
    case "high":
      return "highLow";
    default:
      return "dozenColumn";
  }
}


/**
 * The server writes its refusals to be shown, so they are shown verbatim.
 * The fallback is only for the case where there is no message at all.
 */
/**
 * Did the placement fail in a way that might still have taken the money?
 *
 * Only the remote-wallet path can be ambiguous: locally the debit and the bet
 * row commit together, so a failure took nothing. The server sends this code
 * with a 502 and says as much in the message.
 */
function isAmbiguousPlacement(err: unknown): boolean {
  // The server's OWN code, and nothing else. A bare 502 is any gateway hiccup,
  // including one on a local player's placement that took no money — clearing
  // their layout and refusing to let them re-bet the round for that is a worse
  // outcome than the double debit this guards against.
  return errorCodeOf(err) === "REMOTE_WALLET_UNAVAILABLE";
}

/**
 * The server's error code, dug out of the shape `customFetch` actually throws.
 *
 * This read used to be a bare `err.code`, and `ApiError` HAS NO `code` — the
 * body is on `.data`, as `{ error: { code, message } }` (middlewares/error.ts).
 * So the ambiguous-placement branch below could never be true: every 502 took
 * the refusal path, which re-arms Bet Ok and CLEARS the idempotency key, and
 * the retry it invited was a brand-new bet with a new transaction id. That is
 * precisely the double debit the key was added to prevent, and the guard
 * written to prevent it was reading a field that does not exist.
 */
function errorCodeOf(err: unknown): string | null {
  const e = err as
    | { code?: unknown; data?: { error?: { code?: unknown }; code?: unknown } }
    | null
    | undefined;
  for (const c of [e?.code, e?.data?.error?.code, e?.data?.code]) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

function messageOf(err: unknown): string {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === "string" && m.length > 0 ? m : "Bet refused";
}

/**
 * The server's refusal, shown as sent — except `ABOVE_MAX_PER_SPOT`, which
 * gets ". <selection> is full." appended from `details.selection`: the
 * server's sentence names the type and the figure but not WHICH straight, and
 * on a board of thirty-six that is the part to act on (parity spec 16 §4).
 */
export function refusalLine(err: unknown): string {
  const msg = messageOf(err);
  const d = (err as { data?: { error?: { details?: unknown } } } | null)?.data?.error?.details as
    | { code?: unknown; selection?: unknown }
    | undefined;
  if (d?.code === "ABOVE_MAX_PER_SPOT" && Array.isArray(d.selection) && d.selection.length > 0) {
    return `${msg}. ${d.selection.join("/")} is full.`;
  }
  return msg;
}

/**
 * The server did not ANSWER — as opposed to answering "no". A rejected fetch
 * (network gone) has no status at all; a 502/503/504 carrying none of our
 * error envelope is a gateway speaking for a server it could not reach. Both
 * are re-sent with the same key. A refusal, an ambiguous-debit report or any
 * other answer from OUR server is final.
 */
function isNoAnswer(err: unknown): boolean {
  const e = err as { name?: unknown; status?: unknown } | null;
  if (e?.name !== "ApiError") return true;
  return typeof e.status === "number" && e.status >= 502 && errorCodeOf(err) === null;
}
