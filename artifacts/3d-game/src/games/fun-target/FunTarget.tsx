import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Maximize, Minimize, Volume2, VolumeX } from "lucide-react";
import { customFetch, useGetWalletBalance, getGetWalletBalanceQueryKey, getListMyBetsQueryKey, getListWalletTransactionsQueryKey } from "@workspace/api-client-react";
import { useTableRound, type TableRoundState } from "@/components/table/useTableRound";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { rupeesToPaise } from "@/lib/format";
import { useStore } from "@/game/store";
import { unlockAudio } from "@/game/audio";
import Cabinet from "./Cabinet";
import { cabinetSeconds, lockSeconds, AUTO_PLACE_LEAD_SECONDS, DEFAULT_TAIL, SPIN_DURATION_MS } from "./clock";
import { playSound, stopSounds } from "./sounds";
import { activeBets, errorCode, isUncertainFailure, precheck, restorePlacement, totalStake, wireBets } from "./helpers";
import type { Chip, Config, Outcome, PendingPlacement, Reveal, WireBet } from "./types";
import { ft, type FunTargetKey } from "./i18n";
import "./fun-target.css";

/**
 * The WINNER meter, off the platform's `pending_wins` row (the same contract
 * the two wheels use: GET /win, POST /win/take). NO MONEY MOVES through it —
 * settlement already credited the wallet, the row only says the player has
 * not acknowledged the win, and the screen draws Score = balance − meter.
 */
interface WinMeter { pendingWin: { amountPaise: string; roundId: string | null; lastWonAt: string } | null }
const precheckKeys: Record<string, FunTargetKey> = { empty: "funTargetEmpty", minimum: "funTargetMinimum", maximum: "funTargetMaximum", funds: "funTargetFunds", invalid: "funTargetInvalid", positions: "funTargetInvalid", disabled: "funTargetDisabled" };
const serverKeys: Record<string, FunTargetKey> = { STAKE_TOO_SMALL: "funTargetMinimum", STAKE_TOO_LARGE: "funTargetMaximum", ABOVE_MAX_PER_SPOT: "funTargetMaximum", INSUFFICIENT_FUNDS: "funTargetFunds", GAME_DISABLED: "funTargetDisabled", GAME_NOT_ALLOWED: "funTargetDisabled", BETTING_CLOSED: "funTargetExpired" };

/** The Take glow's one cycle (`.…-take-ready`, 0.8 s): the one blink a win gets before it is taken. */
const AUTO_TAKE_AFTER_MS = 800;

function preventDrag(event: DragEvent<HTMLElement>) {
  event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none";
}

export default function FunTarget({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const platformSound = useStore(s => s.settings.sound), lang = useStore(s => s.settings.language);
  const [muted, setMuted] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const sound = platformSound && !muted;
  const page = useRef<HTMLElement>(null);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === page.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => { if (!sound) stopSounds(); return stopSounds; }, [sound]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await page.current?.requestFullscreen();
    } catch { /* The viewport remains filled when the embedder disallows fullscreen. */ }
  };
  const qc = useQueryClient();

  const text = (key: FunTargetKey) => ft(lang, key);
  const [chip, setChip] = useState(10), [draft, setDraft] = useState<Chip[]>([]);
  const draftRef = useRef(draft); draftRef.current = draft;
  const draftKey = useRef<string | null>(null);
  const [removeMode, setRemoveMode] = useState(false), [notice, setNotice] = useState<FunTargetKey | null>(null);
  const [pending, setPending] = useState<PendingPlacement | null>(null), pendingRef = useRef<PendingPlacement | null>(null);
  const inFlight = useRef(false), alive = useRef(true);
  const requestAbort = useRef<AbortController | null>(null);
  const [acceptedRound, setAcceptedRound] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null), [landed, setLanded] = useState<{ roundId: string; pocket: number } | null>(null);
  const [queued, setQueued] = useState<(Reveal & { startsAt: number }) | null>(null);
  const [awaitingWin, setAwaitingWin] = useState(false);
  const awaitingWinRef = useRef(false); awaitingWinRef.current = awaitingWin;
  const [spinning, setSpinning] = useState(false);
  const [taking, setTaking] = useState(false), [taken, setTaken] = useState(0n);
  /** The wheel's verdict on the last round the player was in, until they act again. */
  const [verdict, setVerdict] = useState<"won" | "lost" | null>(null);
  /**
   * The wheels' hold: a win still uncollected when the NEXT round's count
   * reaches zero pins the clock at 0:00, stops rounds being shown, and the
   * line asks for the points until TAKE — then the live clock and the
   * history strip resume from the server. Until that boundary the player
   * watches the clock run down under "Congratulations!!! You Win.".
   */
  const [frozenAtZero, setFrozenAtZero] = useState(false);
  const frozenRef = useRef(false); frozenRef.current = frozenAtZero;
  const winnerRef = useRef(0n), takingRef = useRef(false);
  const frozenHistory = useRef<number[] | null>(null);
  /** The winning layout, held on the digits until TAKE (the wheels' `heldStakes`). */
  const [heldBets, setHeldBets] = useState<WireBet[] | null>(null);
  /** Latched once the staged total reaches the minimum this round (roulette 08 §7.1). */
  const [reachedMinimum, setReachedMinimum] = useState(false);
  /**
   * Prev Bet, exactly as the wheels do it: Bet Ok becomes "Prev Bet" for the
   * ONE round after a round the player bet in, and a press re-stages the last
   * layout PLACED (staged, not sent) and hands the confirm back to Bet Ok. A
   * refusal clears the layout — a round nobody bet in offers nothing.
   */
  const lastBetsRef = useRef<Chip[]>([]), lastBetRound = useRef<string | null>(null);
  const [offerPrevBet, setOfferPrevBet] = useState(false);
  const roundRef = useRef<TableRoundState<Outcome> | null>(null);
  const storageKey = "fun-target:placement:" + (user?.id ?? "guest");
  const cfgQ = useQuery({ queryKey: ["fun-target", "config"], queryFn: () => customFetch<Config>("/api/fun-target/config"), refetchInterval: 10000 });
  const balance = useGetWalletBalance(
    { game: "lunar" },
    { query: { queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }), enabled: !!user, retry: false } },
  );
  // Polled at 1 Hz only while a matching bet's win is still to arrive: locally
  // the meter is armed at settlement, before the spin; on a partner stream it
  // arms when the partner's wallet ACCEPTS the credit, which can be after the
  // wheel has stopped.
  const meterQ = useQuery<WinMeter>({
    queryKey: ["fun-target", "win"],
    queryFn: () => customFetch<WinMeter>("/api/fun-target/win"),
    enabled: !!user, retry: false, staleTime: 2000,
    refetchInterval: () => (awaitingWinRef.current ? 1000 : false),
  });
  const refreshMoney = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["fun-target", "win"] });
  }, [qc]);
  const round = useTableRound<Outcome>("fun-target", {
    enabled: !!user, croupierVoice: false,
    onBettingOpen: () => { setRemoveMode(false); setNotice(null); setReachedMinimum(false); },
    onResult: (raw, roundId) => {
      const outcome = raw as Outcome;
      if (!Number.isInteger(outcome.pocket) || outcome.pocket < 0 || outcome.pocket > 9) return;
      // Rounds are not shown while the clock is held on an uncollected win;
      // the strip catches up from the snapshot after TAKE.
      if (frozenRef.current) return;
      const state = roundRef.current;
      const snap = state?.snapshot;
      const t = { ...DEFAULT_TAIL, ...(state?.config ?? {}) };
      // The server publishes at the reveal; the cabinet spins when the whole
      // locked tail has run out, which is the SETTLE deadline — the next
      // round's betting starts under the spin, as it does on the wheels.
      const startsAt = snap && snap.roundId === roundId && state
        ? state.toLocalTime(snap.settleEndsAt)
        : Date.now() + t.revealDurationMs + t.settleDurationMs;
      setQueued({ roundId, pocket: outcome.pocket, duration: SPIN_DURATION_MS, bets: activeBets(state?.myBets ?? []), scoreBeforeResult: available > winner ? available - winner : 0n, startsAt });
    },
    onSettled: refreshMoney,
  });
  roundRef.current = round;
  const tail = round.config ?? cfgQ.data ?? DEFAULT_TAIL;
  const LOCK = lockSeconds(tail);
  const seconds = frozenAtZero ? 0 : cabinetSeconds(round.phase, round.remainingMs, tail);
  const bettingOpen = !frozenAtZero && round.bettingOpen && seconds !== null && seconds > LOCK;
  useEffect(() => {
    if (!queued) return;
    const timer = setTimeout(() => {
      // A spin due while a win sits on the meter is not shown: it is the next
      // round's, it fires at the very instant the hold begins, and the strip
      // catches up after TAKE. A round's OWN spin never meets this — its win
      // is withheld until the wheel has stopped.
      if (frozenRef.current || winnerRef.current > 0n) { setQueued(null); return; }
      setReveal(queued); setQueued(null); setSpinning(true); setLanded(null); setNotice(null);
    }, Math.max(0, queued.startsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [queued]);
  const cfg = cfgQ.data && round.config ? { ...cfgQ.data, ...round.config } : cfgQ.data;
  const available = BigInt(balance.data?.balance ?? "0");
  const perSpot = (round.config as (typeof round.config & { maxPerSpotPaise?: string | null }))?.maxPerSpotPaise;
  const accepted = activeBets(round.myBets);
  const locked = acceptedRound === round.roundId || accepted.length > 0;

  // ── The WINNER meter ────────────────────────────────────────────────────
  const pendingWin = meterQ.data?.pendingWin ?? null;
  const meterKey = pendingWin ? `${pendingWin.roundId}:${pendingWin.lastWonAt}:${pendingWin.amountPaise}` : null;
  // What the last TAKE drained, held until the server's row moves on so the
  // meter does not flash back up between the press and the refetch.
  const [collected, setCollected] = useState<{ key: string; amount: bigint } | null>(null);
  const collectedAmount = collected && collected.key === meterKey ? collected.amount : 0n;
  // Withheld until its reveal has been shown: the row is armed at settlement,
  // seconds before the wheel turns, and a meter lighting up early is the
  // result read ahead of the spin.
  const unrevealed = pendingWin?.roundId != null && (queued?.roundId === pendingWin.roundId || (spinning && reveal?.roundId === pendingWin.roundId));
  const rawWinner = pendingWin && !unrevealed ? BigInt(pendingWin.amountPaise) - collectedAmount : 0n;
  const winner = rawWinner > 0n ? rawWinner : 0n;
  const celebrated = useRef<string | null>(null);
  useEffect(() => {
    if (winner <= 0n || !meterKey || celebrated.current === meterKey) return;
    // Once per win: after the landing on this screen, or on arrival to one
    // still uncollected.
    celebrated.current = meterKey;
    setAwaitingWin(false); setNotice(null); playSound("win", sound);
  }, [winner, meterKey, sound]);

  const canBet = !!user && !!cfg?.enabled && balance.data !== undefined && bettingOpen && !locked && !pending && !queued && !spinning && !awaitingWin && winner === 0n;
  const canBetRef = useRef(canBet); canBetRef.current = canBet;
  const offered = offerPrevBet && canBet && draft.length === 0;
  const setChips = (chips: Chip[]) => { draftRef.current = chips; setDraft(chips); };
  /**
   * The wallet as it read when the placement was sent. Shown, minus the
   * pending stake, until BOTH the slip and the debit have been read back:
   * the two land at different moments, and subtracting the stake from a
   * balance that already carries the debit (or from neither) showed the
   * Score jumping by one stake for a frame.
   */
  const balanceAtSend = useRef<bigint | null>(null);
  const savePending = (value: PendingPlacement | null) => {
    pendingRef.current = value;
    if (value) canBetRef.current = false;
    if (!value) balanceAtSend.current = null;
    setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Memory still retains the retry key if storage is unavailable. */ }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const previous = restorePlacement(sessionStorage.getItem(storageKey));
      if (previous) { pendingRef.current = previous; setPending(previous); }
    } catch { /* Private browsing can disable storage. */ }
    return () => { alive.current = false; requestAbort.current?.abort(); };
  }, [storageKey]);
  const previousRound = useRef<string | null>(null);
  useEffect(() => {
    if (!round.roundId) return;
    if (previousRound.current && previousRound.current !== round.roundId) {
      // The count reached zero with a win still on the meter: hold the clock
      // at 0:00 until TAKE. Read after a running drain, so a take in flight
      // at the turnover does not re-freeze.
      if (winnerRef.current > 0n && !takingRef.current) { setFrozenAtZero(true); setQueued(null); }
      if (draftRef.current.length > 0 && !pendingRef.current) { setChips([]); draftKey.current = null; setNotice("funTargetExpired"); }
      // Offered for ONE round, and only after a round the player was in.
      setOfferPrevBet(lastBetsRef.current.length > 0 && lastBetRound.current === previousRound.current);
      setReachedMinimum(false);
      refreshMoney();
    }
    previousRound.current = round.roundId;
    if (round.phase !== null && !bettingOpen && draftRef.current.length && !pendingRef.current) {
      setChips([]); draftKey.current = null; setNotice("funTargetExpired");
    }
  }, [round.roundId, round.phase, bettingOpen, refreshMoney]);
  useEffect(() => {
    if (accepted.length) { setAcceptedRound(round.roundId); }
  }, [round.roundId, accepted.length]);
  const sendPending = async (operation: PendingPlacement) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController(); requestAbort.current = controller;
    // A stalled connection must eventually release the retry loop without changing its key.
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      await customFetch<{ slipId: string; roundId: string; betId: string }>("/api/fun-target/place", {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key },
        body: JSON.stringify({ bets: operation.bets, roundId: operation.roundId, pricingVersion:operation.pricingVersion }),
      });
      if (!alive.current || pendingRef.current?.key !== operation.key) return;
      setAcceptedRound(operation.roundId);
      // The server's copy first, then the staged chips go: cleared before the
      // snapshot holds the slip, the digits went blank for a round trip; and
      // the wallet with it, or the Score jumped up by the stake for the gap
      // between the slip landing and the debit landing.
      await Promise.all([
        roundRef.current?.refetch().catch(() => {}),
        qc.refetchQueries({ queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }) }).catch(() => {}),
      ]);
      if (!alive.current || pendingRef.current?.key !== operation.key) return;
      setChips([]); draftKey.current = null; savePending(null);
      setNotice(null);
      refreshMoney();
    } catch (error) {
      if (!alive.current || pendingRef.current?.key !== operation.key) return;
      if (isUncertainFailure(error)) setNotice("funTargetRetrying");
      else {
        savePending(null); draftKey.current = null;
        // A refusal placed nothing, so there is no "last layout" to offer.
        lastBetsRef.current = []; lastBetRound.current = null;
        const code = errorCode(error); setNotice(serverKeys[code] ?? "funTargetError");
        if (code === "BETTING_CLOSED" || code === "IDEMPOTENCY_KEY_REUSED" || code === "PRIOR_PLACEMENT_VOIDED") setChips([]);
        refreshMoney(); void roundRef.current?.refetch().catch(() => {});
      }
    } finally { clearTimeout(timeout); requestAbort.current = null; inFlight.current = false; }
  };
  const sendRef = useRef(sendPending); sendRef.current = sendPending;
  useEffect(() => {
    if (!pending || !round.roundId) return;
    if (pending.roundId !== round.roundId) {
      requestAbort.current?.abort();
      savePending(null); setChips([]); draftKey.current = null; setNotice("funTargetUncertain"); refreshMoney(); return;
    }
    // Keep the same immutable body and key even if the first response was lost.
    const timer = setInterval(() => { void sendRef.current(pending); }, 3000);
    return () => clearInterval(timer);
  }, [pending, round.roundId, refreshMoney]);
  const autoAttemptedDraft = useRef<Chip[] | null>(null);
  const place = () => {
    if (!canBetRef.current || pendingRef.current || inFlight.current || !cfg || !round.roundId ||
      round.phaseEndsAt === null || Date.now() >= round.phaseEndsAt) return;
    // Manual and automatic confirmation share one guard, body and retry key.
    // A refused or invalid layout needs an edit before another automatic attempt.
    autoAttemptedDraft.current = draftRef.current;
    const bets = wireBets(draftRef.current);
    const error = precheck(bets, cfg, available, perSpot);
    if (error) { setNotice(precheckKeys[error]); return; }
    unlockAudio();
    // The layout Prev Bet offers next round is the one PLACED — recorded at
    // the send, cleared again if the server refuses it.
    lastBetsRef.current = draftRef.current; lastBetRound.current = round.roundId;
    setVerdict(null); setReachedMinimum(false); setOfferPrevBet(false);
    const operation = { key: draftKey.current ?? crypto.randomUUID(), roundId: round.roundId, bets, pricingVersion:round.config?.pricingVersion };
    savePending(operation); balanceAtSend.current = available;
    setNotice(null); playSound("bet", sound); void sendPending(operation);
  };
  const placeRef = useRef(place); placeRef.current = place;
  useEffect(() => {
    if (!canBet || seconds === null || seconds > LOCK + AUTO_PLACE_LEAD_SECONDS || seconds <= LOCK ||
      draftRef.current.length === 0 || autoAttemptedDraft.current === draftRef.current) return;
    // The second before the lock is a catch-up if a delayed frame misses the first.
    placeRef.current();
  }, [canBet, seconds, draft, LOCK]);
  const stage = (digit: number, repeat = 0) => {
    if (!canBetRef.current || !cfg) return;
    unlockAudio();
    if (removeMode && draftRef.current.some(c => c.digit === digit)) {
      setChips(draftRef.current.filter(c => c.digit !== digit)); setRemoveMode(false); draftKey.current = crypto.randomUUID();
      playSound("chip", sound); setNotice(null); return;
    }
    setRemoveMode(false);
    const next = [...draftRef.current, { digit, amount: BigInt(rupeesToPaise(chip)) }];
    const error = precheck(wireBets(next), cfg, available, perSpot);
    if (error && error !== "minimum") { setNotice(precheckKeys[error]); return; }
    if (error !== "minimum") setReachedMinimum(true);
    setChips(next); draftKey.current = crypto.randomUUID(); setNotice(null); setLanded(null); setVerdict(null); setOfferPrevBet(false);
    if (repeat % 2 === 0) playSound("bet", sound);
  };
  const clear = () => {
    if (!canBetRef.current || pendingRef.current) return;
    if (draftRef.current.length > 0) {
      setChips([]); draftKey.current = null; setNotice(null);
      playSound("chip", sound);
    }
    setRemoveMode(false);
  };
  const cancelSpecific = () => {
    if (!canBetRef.current || draftRef.current.length === 0) return;
    setRemoveMode(m => !m); setNotice(null);
  };
  /** Prev Bet: re-stage the last placed layout. Staged, NOT sent. */
  const prevBet = () => {
    const last = lastBetsRef.current;
    if (!canBetRef.current || last.length === 0) return;
    unlockAudio();
    const total = last.reduce((sum, c) => sum + c.amount, 0n);
    if (total > available) { setNotice("funTargetFunds"); return; }
    playSound("bet", sound);
    // A COPY, not the array the last placement sent: the auto-confirm skips a
    // draft it has already tried by identity, and the last layout IS that
    // draft — re-staged as-is it was never auto-sent and the deadline discarded it.
    setChips([...last]); draftKey.current = crypto.randomUUID(); autoAttemptedDraft.current = null;
    setVerdict(null); setLanded(null); setNotice(null); setReachedMinimum(true);
    // Offered once per round: clearing the table afterwards is editing, not a
    // reason to blink the offer again.
    setOfferPrevBet(false);
  };
  const onLand = useCallback((roundId: string, pocket: number) => {
    setSpinning(false); setLanded({ roundId, pocket });
    const bets = reveal?.roundId === roundId ? reveal.bets : [];
    if (bets.length && !bets.some(bet => bet.selection[0] === pocket)) {
      setVerdict("lost"); playSound("lose", sound);
    } else if (bets.length) {
      // The meter effect above celebrates once the row is read; the layout
      // stays on the digits until the points are taken.
      setVerdict("won"); setAwaitingWin(true); setHeldBets(bets);
    }
    refreshMoney();
  }, [reveal, sound, refreshMoney]);
  // Take: reported on the PRESS, drained on screen afterwards. The platform has
  // already credited the wallet; this only clears the meter row.
  const takeRef = useRef<{ key: string; amount: bigint } | null>(null);
  useEffect(() => {
    if (!taking) return;
    const started = performance.now(), amount = takeRef.current?.amount ?? 0n;
    let frame = 0;
    const advance = () => {
      const progress = Math.min(1000, Math.max(0, Math.floor(performance.now() - started - 700)));
      setTaken(amount * BigInt(progress) / 1000n);
      if (progress < 1000) { frame = requestAnimationFrame(advance); return; }
      if (takeRef.current) setCollected(takeRef.current);
      setTaken(0n); setTaking(false); setNotice(null);
      // Collected: the clock and the strip go back to the server's round, and
      // the line goes back to the ordinary prompts.
      setFrozenAtZero(false); frozenHistory.current = null; setVerdict(null); setLanded(null); setHeldBets(null);
      void meterQ.refetch(); refreshMoney(); void roundRef.current?.refetch().catch(() => {});
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taking]);
  useEffect(() => {
    if (!taking || !sound) return;
    let stop = playSound("take", sound);
    const timer = setTimeout(() => { stop = playSound("drain", sound); }, 700);
    return () => { clearTimeout(timer); stop(); };
  }, [taking, sound]);
  const take = () => {
    if (winner === 0n || taking || !meterKey) return;
    unlockAudio(); takeRef.current = { key: meterKey, amount: winner }; setTaken(0n); setTaking(true);
    void customFetch("/api/fun-target/win/take", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ takeKey: crypto.randomUUID() }),
    }).catch(() => undefined);
  };
  // AUTO-TAKE (operator request, 2026-09-26): no win is ever left waiting.
  // A win on the meter lights Take for ONE 0.8 s glow (the CSS runs it once)
  // and is then taken for the player through `take()` itself —
  // press sound, drain into the Score, server row cleared. Moves no money.
  const pressTakeRef = useRef(take); pressTakeRef.current = take;
  useEffect(() => {
    if (winner <= 0n || taking) return;
    const timer = setTimeout(() => pressTakeRef.current(), AUTO_TAKE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [winner, taking]);
  const clockBeat = useRef<string | null>(null);
  useEffect(() => {
    const beat = `${round.roundId}:${seconds}`;
    // Silent at zero and while held on a win — a tick under a still digit
    // reads as a fault.
    if (sound && seconds !== null && seconds > 0 && clockBeat.current !== beat) {
      clockBeat.current = beat; playSound("tick", sound);
    }
  }, [seconds, round.roundId, sound]);
  winnerRef.current = winner; takingRef.current = taking;
  const displayedWinner = winner > taken ? winner - taken : 0n;
  // A placement still pending keeps its stake off the Score even once the
  // slip shows on the snapshot — it is cleared only after the wallet caught up.
  const stagedBets = wireBets(draft), stagedTotal = totalStake(pending?.bets ?? (accepted.length ? [] : stagedBets));
  const shownBalance = pending && balanceAtSend.current !== null ? balanceAtSend.current : available;
  const shownBets = winner > 0n && heldBets ? heldBets : (spinning || awaitingWin) && reveal ? reveal.bets : accepted.length ? accepted : pending?.bets ?? stagedBets;
  const snapshotRecent = round.recent.filter(r => r.roundId !== queued?.roundId && !(spinning && r.roundId === reveal?.roundId));
  const liveHistory = snapshotRecent.slice(0, 10).reverse().map(r => (r.outcome as Outcome).pocket);
  if (landed && !snapshotRecent.some(r => r.roundId === landed.roundId)) liveHistory.push(landed.pocket);
  // Held with the clock: the strip stops at the won round until TAKE.
  if (frozenAtZero && frozenHistory.current === null) frozenHistory.current = liveHistory;
  const history = frozenAtZero && frozenHistory.current ? frozenHistory.current : liveHistory;
  const restingPocket = landed?.pocket ?? (snapshotRecent[0]?.outcome as Outcome | undefined)?.pocket ?? null;
  /**
   * The status line, in the ROULETTE cabinet's priority order (RouletteScreen
   * `statusLine`): a notice, the spin, a held win, the removal prompt, the
   * staged choice, the acceptance, the verdict, the close, then the idle
   * prompt with the minimum.
   */
  const minPoints = cfg ? Number(BigInt(cfg.minStakePaise) / 100n) : 0;
  const message = cfgQ.isError ? text("funTargetConfigError")
    : notice ? (notice === "funTargetMinimum" ? `${text("funTargetMinimum")}${minPoints}` : text(notice))
    : spinning ? text("funTargetSpin")
    // A win on the meter says so until it is taken; the request for the points
    // appears only once the clock is being held for it.
    : winner > 0n ? text(frozenAtZero ? "funTargetTakePrompt" : "funTargetWin")
    : removeMode ? text("funTargetRemove")
    : canBet && reachedMinimum ? text("funTargetChoice")
    : locked || pending ? text("funTargetAccepted")
    : awaitingWin || (verdict === "won" && !offered) ? text("funTargetWin")
    : verdict === "lost" ? text("funTargetLose")
    : verdict === "won" && offered ? text("funTargetChoice")
    : round.phase !== null && !bettingOpen ? text("funTargetClosed")
    : round.phase === null ? text("funTargetLoading")
    : `${text("funTargetPrompt")}${minPoints}`;
  const resultVisible = !spinning && landed !== null && (winner > 0n || bettingOpen);
  // No button is ever dimmed — the cabinet's were not, and only the tap is
  // guarded (every handler above returns when the press is not allowed).
  const placeControl = <Button data-testid="btn-place" className={offered || (canBet && draft.length > 0) ? "ft-bet-ready" : ""} onClick={offered ? prevBet : place}>{offered ? text("funTargetPrevBet") : text("funTargetPlace")}</Button>;
  const clearControl = <Button data-testid="btn-clear" onClick={clear}>{text("funTargetClear")}</Button>;
  return <main ref={page} className="ft-page" draggable={false} onDragStartCapture={preventDrag} onDragOverCapture={preventDrag} onDropCapture={preventDrag} onPointerDown={unlockAudio} onKeyDown={unlockAudio}>
    <Cabinet lang={lang} embedded={embedded} sound={sound} spinning={spinning} chip={chip} bets={shownBets}
      balance={spinning && reveal?.scoreBeforeResult !== undefined ? reveal.scoreBeforeResult : shownBalance > stagedTotal + displayedWinner ? shownBalance - stagedTotal - displayedWinner : 0n} winner={displayedWinner} total={totalStake(shownBets)}
      reveal={reveal} restingPocket={restingPocket} resultPocket={resultVisible ? landed.pocket : null}
      history={history.slice(-10)} seconds={seconds}
      canBet={canBet} message={message} removeMode={removeMode}
      onChip={value => { unlockAudio(); setChip(value); playSound("chip", sound); }}
      onDigit={stage} onLand={onLand} controls={{
        take: <Button data-testid="btn-take" title={text("funTargetPaid")} className={winner > 0n && !taking ? "ft-take-ready" : ""} onClick={take}>{text("funTargetTake")}</Button>,
        clear: clearControl,
        specific: <Button data-testid="btn-cancel-specific" onClick={cancelSpecific} aria-pressed={removeMode}>{text("funTargetSpecific")}</Button>,
        place: placeControl,
        exit: <Link href="/" draggable={false}>{text("funTargetExit")}</Link>,
      }} />
    <div className="ft-screen-controls">
      <button type="button" data-testid="btn-sound" aria-label={text(sound ? "funTargetMute" : "funTargetUnmute")} title={text(sound ? "funTargetMute" : "funTargetUnmute")} aria-pressed={!sound} onClick={() => { unlockAudio(); setMuted(value => !value); }}>
        {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      </button>
      {document.fullscreenEnabled && <button type="button" data-testid="btn-fullscreen" aria-label={text(fullscreen ? "funTargetExitFullscreen" : "funTargetFullscreen")} title={text(fullscreen ? "funTargetExitFullscreen" : "funTargetFullscreen")} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>
        {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
      </button>}
    </div>
    <output className="ft-sr-only" data-testid="result-line" aria-live="polite">{text("funTargetResult")}: {!spinning && landed ? landed.pocket : "—"}</output>
  </main>;
}
