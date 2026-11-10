import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Menu,
  Globe2,
  Settings,
  Undo2,
  Repeat2,
  Volume2,
  VolumeX,
  Maximize,
  X,
  Users,
  ChartNoAxesColumnIncreasing,
  ArrowLeft,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
} from "@workspace/api-client-react";
import {
  ICE_FISH_WHEEL,
  ICE_FISH_LABELS,
  ICE_FISH_SPOTS,
  ICE_FISH_SPIN_MS,
  iceFishMultiplier,
  isFish,
  type IceFishBet,
  type IceFishOutcome,
  type IceFishSpot,
} from "@workspace/api-zod/ice-fish";
import { useAuth } from "@/lib/auth";
import { useTableRound } from "@/components/table/useTableRound";
import {
  BET_SEND_BUFFER_MS,
  useChipDraft,
  useTimedBet,
} from "@/components/table/AutoBet";
import { playGameSound, unlockAudio } from "@/game/audio";
import IceWheel, { Anchor, Fish } from "@/components/iceFish/IceWheel";
import IceAtmosphere from "@/components/iceFish/IceAtmosphere";
import IceFishCard from "@/components/iceFish/IceFishCard";
import IceFishingBonus from "@/components/iceFish/IceFishingBonus";
import { fishingPresentation, multiplierLabel } from "@/components/iceFish/iceFishPresentation";
import "@/components/iceFish/ice-fish.css";

type Config = {
  enabled: boolean;
  houseEdge: number;
  maxMultiplier: number;
  minStakePaise: string;
  maxStakePaise: string;
};
type Receipt = {
  roundId: string;
  bets: IceFishBet[];
  totalStake: string;
  payoutAmount: string;
  outcome: IceFishOutcome;
  resultSource: string;
  createdAt: string;
};
type Placement = {
  roundId: string;
  idempotencyKey: string;
  pricingVersion?: string;
  bets: IceFishBet[];
};
const money = (n: string | number | bigint) =>
  `₹ ${Number(n) / 100 < 1000 ? (Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : (Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const sum = (bets: IceFishBet[]) =>
  bets.reduce((n, b) => n + BigInt(b.amountPaise), 0n);
const chips = [10, 50, 100, 250, 500];

export default function IceFish() {
  const { user } = useAuth(),
    qc = useQueryClient(),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Warm the short bonus transition before its server-clock deadline arrives.
    for (const name of ["bet-cards-v5.webp", "wheel-hub-v5.webp", "wheel-fish-v5.webp", "logo-v5.webp", "intro-ice-v4.webp", "coins-v4.webp", "result-ice-v4.webp", "fisher-parts-v6.webp", "fishing-station-v3.webp", "fish-species-v6.webp"]) {
      const image = new Image();
      image.src = `/media/ice-fish/${name}`;
      void image.decode().catch(() => undefined);
    }
  }, []);
  const [chip, setChip] = useState(10),
    [sound, setSound] = useState(
      () => localStorage.getItem("ice-fish:sound") === "true",
    );
  const [modal, setModal] = useState<
    "menu" | "settings" | "history" | "rules" | "fairness" | null
  >(null);
  const [historyTab, setHistoryTab] = useState<"results" | "bets">("results");
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("ice-fish:volume") ?? "0.7");
    return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : .7;
  });
  const [now, setNow] = useState(Date.now),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => localStorage.getItem("ice-fish:motion") === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [last, setLast] = useState<IceFishBet[]>([]),
    [undo, setUndo] = useState<IceFishBet[][]>([]),
    [accepted, setAccepted] = useState<Placement | null>(null);
  const [pending, setPending] = useState<Placement | null>(null),
    sending = useRef(false),
    [verification, setVerification] = useState("");
  const config = useQuery<Config>({
    queryKey: ["ice-fish", "config"],
    queryFn: () => customFetch("/api/ice-fish/config"),
    enabled: !!user,
    refetchInterval: 15000,
  });
  const history = useQuery<Receipt[]>({
    queryKey: ["ice-fish", "history"],
    queryFn: () => customFetch("/api/ice-fish/recent"),
    enabled: !!user,
    retry: false,
  });
  const balance = useGetWalletBalance(undefined, {
    query: { queryKey: getGetWalletBalanceQueryKey(), enabled: !!user },
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: ["ice-fish", "history"] });
  }, [qc]);
  const round = useTableRound<IceFishOutcome>("ice-fish", {
    enabled: !!user,
    onSettled: refresh,
    croupierVoice: false,
  });
  const canSubmit =
    round.bettingOpen &&
    !!config.data?.enabled &&
    !busy &&
    !pending &&
    round.myBets.length === 0 &&
    accepted?.roundId !== round.roundId;
  const canEdit = canSubmit && round.remainingMs > 0;
  const draft = useChipDraft<IceFishSpot>(
    round.roundId,
    canEdit,
    balance.data?.balance ?? "0",
    round.config?.maxStakePaise ?? config.data?.maxStakePaise ?? "0",
  );
  useEffect(() => {
    document.title = "Ice Fish · LunarX";
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void round.refetch(), 2500);
    return () => clearInterval(timer);
  }, [round.refetch]);
  useEffect(() => {
    setUndo([]);
    setError("");
  }, [round.roundId]);
  useEffect(() => {
    if (round.phase !== "betting") draft.clear();
  }, [round.phase]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const dialog = root.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,[tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModal(null);
      }
      if (event.key !== "Tab") return;
      const nodes = focusable(),
        first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [modal]);
  const settled = round.myBets
    .filter((b) => b.status === "settled")
    .map((b) => b.slipId)
    .join();
  useEffect(() => {
    if (settled) refresh();
  }, [settled, refresh]);
  const seconds = Math.max(0, Math.ceil(round.remainingMs / 1000));
  const revealStart =
    round.snapshot && round.phase !== "betting"
      ? round.toLocalTime(round.snapshot.bettingEndsAt)
      : null;
  const revealElapsed = revealStart === null ? 0 : now - revealStart,
    landed = !!round.outcome && revealElapsed >= ICE_FISH_SPIN_MS;
  const spot = round.outcome ? ICE_FISH_WHEEL[round.outcome.segment] : null;
  const fishing = !!(landed && spot && isFish(spot) && round.phase !== "betting");
  const revealMs = round.snapshot ? round.snapshot.revealEndsAt - round.snapshot.bettingEndsAt : round.config?.revealDurationMs ?? 14000;
  const bonusStage = fishingPresentation(revealElapsed, revealMs, round.phase === "settling").stage;
  const pricing = round.myBets[0]?.pricingConfig ?? round.config;
  const edge = pricing?.houseEdge ?? config.data?.houseEdge ?? 0.045;
  const anchorReturn = ((1 - edge) / 0.955) * 2;
  const anchorLabel =
    anchorReturn < 1
      ? `${anchorReturn.toFixed(2)}x`
      : `${(anchorReturn - 1).toFixed(2).replace(".00", "")}:1`;
  const multiplier = round.outcome
    ? Math.min(
        pricing?.maxMultiplier ?? 5000,
        iceFishMultiplier(round.outcome, edge),
      )
    : 0;
  const myBets = round.myBets.flatMap((b) => b.bets as IceFishBet[]);
  const shownBets = myBets.length
    ? myBets
    : accepted?.roundId === round.roundId
      ? accepted.bets
      : draft.bets;
  const myWin = round.myBets.reduce(
    (n, b) => n + BigInt(b.payoutAmount ?? "0"),
    0n,
  );
  const beep = useRef("");
  useEffect(() => {
    const key = `${round.roundId}:${round.phase}:${seconds}:${landed}`;
    if (!sound || beep.current === key) return;
    beep.current = key;
    if (round.bettingOpen && seconds > 0 && seconds <= 3)
      playGameSound("tick", "ice-fish", volume * 0.5);
    if (landed && revealElapsed < 9700) playGameSound("reveal", "ice-fish", volume);
  }, [seconds, round.phase, round.roundId, sound, landed, volume]);
  const lastSoundStage = useRef("");
  useEffect(() => {
    const stage = fishing ? bonusStage : round.phase === "reveal" && !landed ? "spin" : "";
    const key = `${round.roundId}:${stage}`;
    if (!sound || !stage || lastSoundStage.current === key) return;
    lastSoundStage.current = key;
    const cue = stage === "spin" ? "roll" : stage === "underwater" ? "deal" : stage === "casting" ? "launch" : stage === "reeling" ? "roll" : stage === "catch" ? "impact" : "reveal";
    playGameSound(cue, "ice-fish", volume * .7);
  }, [fishing, bonusStage, round.phase, round.roundId, landed, sound, volume]);
  const lastWinSound = useRef("");
  useEffect(() => {
    if (!sound || myWin <= 0n || !round.roundId || lastWinSound.current === round.roundId) return;
    lastWinSound.current = round.roundId;
    playGameSound("win", "ice-fish", volume);
  }, [myWin, round.roundId, sound, volume]);
  function stage(bets: IceFishBet[], replace = false) {
    if (!canEdit) return;
    void unlockAudio();
    if (draft.stage(bets, replace)) {
      setUndo((stack) => [...stack, [...draft.bets]]);
      setError("");
      if (sound) playGameSound("select", "ice-fish", volume * 0.5);
    } else setError("Insufficient balance or table limit reached.");
  }
  async function submit(retry?: Placement) {
    if (
      sending.current ||
      (!retry && (!canSubmit || !round.roundId || !draft.bets.length))
    )
      return;
    const request = retry ?? {
      roundId: round.roundId!,
      idempotencyKey: crypto.randomUUID(),
      pricingVersion: round.config?.pricingVersion,
      bets: [...draft.bets],
    };
    sending.current = true;
    setBusy(true);
    setPending(request);
    setError("");
    try {
      await customFetch("/api/ice-fish/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      });
      setAccepted(request);
      setLast(request.bets);
      setPending(null);
      draft.clear();
      refresh();
      void round.refetch();
    } catch (e) {
      const err = e as Error & {
        status?: number;
        data?: { error?: { message?: string } };
      };
      setError(err.data?.error?.message ?? err.message);
      if (err.status && [400, 409, 422].includes(err.status)) {
        setPending(null);
        draft.clear();
        void round.refetch();
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  useTimedBet({
    roundKey: round.roundId,
    deadline:
      round.phaseEndsAt === null
        ? null
        : round.toLocalTime(round.phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt:
      round.phaseEndsAt === null ? null : round.toLocalTime(round.phaseEndsAt),
    armed: draft.bets.length > 0,
    enabled: canSubmit,
    submit: () => submit(),
  });
  const recent = useMemo(
    () => round.recent.filter((r) => r.outcome).slice(0, 21),
    [round.recent],
  );
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    localStorage.setItem("ice-fish:sound", String(next));
    if (next) void unlockAudio();
  };
  async function verify(id: string) {
    setVerification("Checking round…");
    try {
      const result = await customFetch<{ verified: boolean }>(
        `/api/ice-fish/${encodeURIComponent(id)}/verify`,
      );
      setVerification(
        result.verified
          ? "Seed and outcome verified."
          : "The round did not match its seed.",
      );
    } catch (e) {
      setVerification((e as Error).message);
    }
  }
  return (
    <div
      className={`ice-fish-game ${round.phase === "betting" ? "is-betting" : "is-closed"} ${fishing ? "has-fishing-scene" : ""} ${fishing && bonusStage === "intro" ? "is-ice-transition" : ""} ${round.phase === "reveal" && !landed ? "is-spinning" : ""} ${landed ? "has-result" : ""} ${reducedMotion ? "reduce-motion" : ""}`}
      ref={root}
      data-testid="ice-fish-game"
    >
      <div className="if-background" />
      <div className="if-mist" />
      {!fishing && <IceAtmosphere />}
      <Link href="/" className="if-logo" aria-label="Ice Fish — back to lobby">
        <img src="/media/ice-fish/logo-v5.webp" alt="Ice Fish" />
      </Link>
      <button
        className="if-menu-button"
        aria-label="Open game menu"
        onClick={() => setModal("menu")}
      >
        <Menu />
      </button>
      <div className="if-social">
        <span>
          <Users size={18} /> {round.playerCount} PLAYERS
        </span>
        {myWin > 0n && <strong>WINS {money(myWin)}</strong>}
      </div>
      <div
        className={`if-wheel-stage ${round.outcome && round.phase !== "betting" ? "is-zoomed" : ""}`}
      >
        <IceWheel
          outcome={round.outcome}
          roundId={round.roundId}
          revealStart={revealStart}
          now={now}
          reducedMotion={reducedMotion}
        />
      </div>
      {fishing && spot && isFish(spot) && round.outcome && <IceFishingBonus
        color={spot} outcome={round.outcome} elapsed={revealElapsed} revealMs={revealMs}
        settled={round.phase === "settling"} multiplier={multiplier} houseEdge={edge}
        cap={pricing?.maxMultiplier ?? 5000} win={myWin} money={money} reducedMotion={reducedMotion} />}
      {landed && !fishing && round.outcome && (
        <div
          className={`if-result ${myWin > 0n ? "has-win" : ""}`}
          role="status"
          data-testid="ice-fish-result"
          aria-label={spot ? `${ICE_FISH_LABELS[spot]} result` : "Wheel result"}
        >
          <div className="if-result-catch">
            {spot && isFish(spot) ? (
              <Fish color={spot} />
            ) : (
              <Anchor grey={spot === "grey"} />
            )}
            <strong>{multiplierLabel(multiplier)}</strong>
          </div>
          <span>
            {myWin > 0n
              ? `YOU WON ${money(myWin)}`
              : spot
                ? ICE_FISH_LABELS[spot]
                : ""}
          </span>
        </div>
      )}
      {landed && <div className="if-next-round">NEXT GAME SOON...</div>}
      <section className="if-bet-console" aria-label="Ice Fish betting">
        <div className="if-countdown" aria-live="polite">
          <strong>
            {busy
              ? "CONFIRMING BET"
              : !round.roundId
                ? "CONNECTING…"
                : round.phase === "betting"
                  ? accepted?.roundId === round.roundId || myBets.length
                    ? "BETS ACCEPTED"
                    : "PLACE YOUR BET"
                  : landed
                    ? "NEXT GAME SOON…"
                    : "NO MORE BETS"}
          </strong>
          {round.phase === "betting" && (
            <>
              <div className="if-clock-track">
                <i
                  style={{
                    width: `${Math.max(0, (round.remainingMs / Math.max(1, (round.phaseDurationMs ?? 12000) - BET_SEND_BUFFER_MS)) * 100)}%`,
                  }}
                />
                <b>{seconds}</b>
              </div>
            </>
          )}
        </div>
        <div className="if-spots">
          <div className="if-anchors">
            {(["white", "grey"] as const).map((type) => (
              <button
                key={type}
                disabled={!canEdit}
                aria-label={`Bet ${ICE_FISH_LABELS[type]}`}
                className={`if-anchor-bet ${type}`}
                onClick={() =>
                  stage([{ type, amountPaise: String(chip * 100) }])
                }
              >
                <Anchor grey={type === "grey"} />
                <small>{anchorLabel}</small>
                {shownBets.some((b) => b.type === type) && (
                  <em>
                    {money(sum(shownBets.filter((b) => b.type === type)))}
                  </em>
                )}
              </button>
            ))}
          </div>
          {(["blue", "green", "red"] as const).map((type) => (
            <button
              key={type}
              disabled={!canEdit}
              className={`if-fish-bet ${type}`}
              aria-label={`Bet ${ICE_FISH_LABELS[type]}`}
              onClick={() => stage([{ type, amountPaise: String(chip * 100) }])}
            >
              <IceFishCard color={type} />
              {shownBets.some((b) => b.type === type) && (
                <em>{money(sum(shownBets.filter((b) => b.type === type)))}</em>
              )}
            </button>
          ))}
          <button
            className="if-all-bonuses"
            disabled={!canEdit}
            aria-label="Bet all three fish bonuses"
            onClick={() =>
              stage(
                (["blue", "green", "red"] as const).map((type) => ({
                  type,
                  amountPaise: String(chip * 100),
                })),
              )
            }
          >
            <span>
              <Fish color="blue" />
              <Fish color="green" />
              <Fish color="red" />
            </span>
            <div className="if-all-caption">
              <Globe2 aria-hidden="true" />
              <div>ALL<br />BONUSES</div>
            </div>
          </button>
        </div>
        <div className="if-chip-row">
          <button
            className="if-text-button"
            disabled={!canEdit || !draft.bets.length}
            onClick={() => {
              draft.clear();
              setUndo([]);
            }}
            aria-label="Cancel selected bets"
          >
            CANCEL
          </button>
          <div className="if-chip-tray">
            <button
              aria-label="Undo last chip"
              disabled={!canEdit || !undo.length}
              onClick={() => {
                draft.stage(undo[undo.length - 1], true);
                setUndo((stack) => stack.slice(0, -1));
              }}
            >
              <Undo2 />
            </button>
            {chips.map((value) => (
              <button
                key={value}
                className={`if-chip chip-${value} ${chip === value ? "is-selected" : ""}`}
                onClick={() => setChip(value)}
                aria-label={`Select ₹${value} chip`}
                aria-pressed={chip === value}
              >
                <span>{value}</span>
              </button>
            ))}
            <button
              aria-label="Repeat previous bets"
              disabled={!canEdit || !last.length}
              onClick={() => stage(last, true)}
            >
              <Repeat2 />
            </button>
          </div>
          <button
            className="if-text-button"
            disabled={!canEdit || !last.length}
            onClick={() => stage(last, true)}
          >
            REPEAT
          </button>
        </div>
        {draft.bets.length > 0 && canEdit && (
          <div className="if-draft-status" role="status">
            Selected {money(sum(draft.bets))} · confirms at timer end
          </div>
        )}
      </section>
      <div className="if-wallet">
        <button aria-label="Game settings" onClick={() => setModal("settings")}>
          <Settings />
        </button>
        <div>
          <b>Balance:</b>
          <strong>{money(balance.data?.balance ?? "0")}</strong>
        </div>
        <div>
          <b>Bet</b>
          <strong>{money(sum(shownBets))}</strong>
        </div>
      </div>
      <aside className="if-history" aria-label="Recent wheel results">
        <div className="if-history-dots">
          {recent.map((r) => {
            const o = r.outcome as IceFishOutcome,
              type = ICE_FISH_WHEEL[o.segment];
            return (
              <button
                key={r.roundId}
                title={`${ICE_FISH_LABELS[type]}${o.boosts[o.segment] > 1 ? ` · ${o.boosts[o.segment]}x boost` : ""}`}
                aria-label={`Previous result ${ICE_FISH_LABELS[type]}`}
                className={`if-dot ${type}`}
                onClick={() => setModal("history")}
              >
                {isFish(type) && <Fish color={type} />}{" "}
                {o.boosts[o.segment] > 1 && <b>{o.boosts[o.segment]}x</b>}
              </button>
            );
          })}
        </div>
        <button
          className="if-stats"
          aria-label="Open results and bet history"
          onClick={() => setModal("history")}
        >
          <ChartNoAxesColumnIncreasing />
        </button>
      </aside>
      {(error || config.isError) && (
        <div className="if-error" role="alert">
          {error || "Game connection unavailable. Reconnecting…"}
          {pending && (
            <button disabled={busy} onClick={() => submit(pending)}>
              Check / retry bet
            </button>
          )}
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="if-modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="if-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Ice Fish ${modal}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{modal === "menu" ? "ICE FISH" : modal.toUpperCase()}</h2>
              <button aria-label="Close dialog" onClick={() => setModal(null)}>
                <X />
              </button>
            </header>
            {modal === "menu" && (
              <nav>
                <button onClick={() => setModal("rules")}>How to play</button>
                <button onClick={() => setModal("history")}>
                  My bets & results
                </button>
                <button onClick={() => setModal("fairness")}>
                  Round verification
                </button>
                <button onClick={() => setModal("settings")}>Settings</button>
                <Link href="/">
                  <ArrowLeft /> Back to lobby
                </Link>
              </nav>
            )}
            {modal === "settings" && (
              <div className="if-settings">
                <button onClick={toggleSound}>
                  {sound ? <Volume2 /> : <VolumeX />} Sound{" "}
                  {sound ? "on" : "off"}
                </button>
                <label className="if-volume-control">Sound volume<input aria-label="Sound volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e => { const value = Number(e.target.value); setVolume(value); localStorage.setItem("ice-fish:volume", String(value)); }} /></label>
                <button onClick={() => setReducedMotion((v) => { localStorage.setItem("ice-fish:motion", v ? "on" : "reduced"); return !v; })}>
                  Animations {reducedMotion ? "reduced" : "on"}
                </button>
                <button
                  onClick={() => {
                    if (document.fullscreenElement)
                      void document.exitFullscreen().catch(() => setError("Full screen is unavailable on this browser."));
                    else void root.current?.requestFullscreen?.().catch(() => setError("Full screen is unavailable on this browser."));
                  }}
                >
                  <Maximize /> Full screen
                </button>
              </div>
            )}
            {modal === "rules" && (
              <div className="if-rules">
                <p>
                  Select a chip, then tap a white anchor, grey anchor or fish.
                  Selected bets confirm automatically when the timer ends.
                  Cancel or undo before the countdown closes.
                </p>
                <p>
                  All Bonuses places your selected chip on each of the three
                  fish. Repeat restores your previous accepted selection for
                  this round.
                </p>
                <p>
                  The wheel has 45 positions: 19 white anchors, 19 grey anchors,
                  4 Lil’ Blues, 2 Big Green and 1 Huge Reds. Boosted positions
                  increase the return. A fish result reveals a bonus catch.
                </p>
                <p>The fishing bonus shows possible catches underwater, then casts, reels and lifts the server-selected fish. Its multiplier includes any wheel boost. Watching or rejoining does not place a bet or change the catch. Only your own settled winnings are shown.</p>
                <p>
                  Current player return target:{" "}
                  <strong>{((1 - edge) * 100).toFixed(2)}%</strong>. Returns
                  include stake and use the rates accepted with your bet.
                  Rounding and caps can reduce returns; a short session is not
                  guaranteed to match the target.
                </p>
                <p>
                  Configured table result modes may select outcomes. Natural
                  rounds can be checked using their revealed seed. Balance and
                  payouts settle automatically.
                </p>
                <p>
                  Stake: {money(config.data?.minStakePaise ?? "100")}–
                  {money(config.data?.maxStakePaise ?? "500000")} per round.
                </p>
              </div>
            )}
            {modal === "history" && (
              <div className="if-bet-history">
                <div className="if-results-tabs" role="tablist" aria-label="Results and bets">
                  <button role="tab" aria-selected={historyTab === "results"} onClick={() => setHistoryTab("results")}>Wheel results</button>
                  <button role="tab" aria-selected={historyTab === "bets"} onClick={() => setHistoryTab("bets")}>My bets</button>
                </div>
                {historyTab === "results" ? <>
                  <div className="if-result-distribution" aria-hidden="true">{ICE_FISH_SPOTS.map(type => <i key={type} style={{ flex: recent.filter(r => ICE_FISH_WHEEL[(r.outcome as IceFishOutcome).segment] === type).length, background: {white:"#edfaff",grey:"#8195a8",blue:"#00b5ed",green:"#57cc48",red:"#ee425c"}[type] }} />)}</div>
                  <div className="if-distribution-legend">{ICE_FISH_SPOTS.map(type => <span key={type}>{ICE_FISH_LABELS[type]}: {recent.filter(r => ICE_FISH_WHEEL[(r.outcome as IceFishOutcome).segment] === type).length}</span>)}</div>
                  {!recent.length && <p>No completed wheel results yet.</p>}
                  {recent.map(r => { const o = r.outcome as IceFishOutcome, type = ICE_FISH_WHEEL[o.segment]; return <div className="if-result-row" key={r.roundId}>
                    {isFish(type) ? <Fish color={type} /> : <Anchor grey={type === "grey"} />}
                    <div><b>{ICE_FISH_LABELS[type]}</b><small>{o.boosts[o.segment] > 1 ? `${o.boosts[o.segment]}x wheel boost · ` : ""}{isFish(type) ? `Catch ${o.fishValue} · ` : ""}{r.settledAt ? new Date(r.settledAt).toLocaleString() : "Revealed"}</small></div>
                    <button onClick={() => { setModal("fairness"); void verify(r.roundId); }}>Verify</button>
                  </div>; })}
                </> : history.isPending ? (
                  <p>Loading bets…</p>
                ) : !history.data?.length ? (
                  <p>No settled bets yet.</p>
                ) : (
                  history.data.map((r, i) => (
                    <article key={`${r.roundId}:${i}`}>
                      <b>
                        {ICE_FISH_LABELS[ICE_FISH_WHEEL[r.outcome.segment]]}
                      </b>
                      <span>
                        Bet {money(r.totalStake)} · Return{" "}
                        {money(r.payoutAmount)}
                      </span>
                      <small>{new Date(r.createdAt).toLocaleString()}</small>
                      <button
                        onClick={() => {
                          setModal("fairness");
                          void verify(r.roundId);
                        }}
                      >
                        Verify round
                      </button>
                    </article>
                  ))
                )}
              </div>
            )}
            {modal === "fairness" && (
              <div className="if-rules">
                <p>
                  Each natural round commits its seed before betting closes. You
                  can verify a revealed result here. Managed results are
                  identified separately.
                </p>
                <code>{round.serverSeedHash ?? "Waiting for round…"}</code>
                <p>{verification}</p>
                {round.outcome && round.roundId && (
                  <button onClick={() => verify(round.roundId!)}>
                    Verify current round
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
