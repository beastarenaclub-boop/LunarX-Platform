import { GameInformationDrawer } from "@/components/game/GameInformation";
import { GameInformationSection, GameInformationTarget, restoreGameInformationFocus } from "@/components/game/GameInformation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Flag,
  MapPin,
  Volume2,
  VolumeX,
  RotateCcw,
  Trophy,
  Maximize2,
  Info,
  X,
  Timer,
  Wallet,
} from "lucide-react";
import {
  customFetch,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatRupees, rupeesToPaise } from "@/lib/format";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio, playGameSound } from "@/game/audio";
import {
  AutoBetStatus,
  useTimedBet,
  BET_SEND_BUFFER_MS,
  useChipDraft,
} from "@/components/table/AutoBet";
import {
  TableCoinRack,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import BikeRaceScene from "@/components/bike-racing/BikeRaceScene";
import { RACE_CAMERAS, CAMERA_STORAGE_KEY, savedRaceCamera } from "@/components/bike-racing/raceCamera";
import { BIKE_PHOTO } from "@/components/bike-racing/photoAssets";
import { useBikeSound } from "@/components/bike-racing/useBikeSound";
import {
  RACING_BIKES,
  RACING_VENUES,
  racingVenue,
  type RacingConfig,
  bikeRoundPhase,
  type RacingLiveState,
  type BikeSlip,
} from "@workspace/api-zod/bike-racing-game";
import "@/components/lucky7/lucky7-scene.css";
import "@/components/horse-racing/horse-racing.css";
import "@/components/bike-racing/bike-racing.css";

type State = RacingLiveState;
const endpoint = "/api/bike-racing/game";
function message(error: unknown) {
  if (error instanceof ApiError) {
    const body = error.data as { detail?: string; title?: string };
    return body?.detail || body?.title || "The bet could not be confirmed.";
  }
  return "Connection interrupted. Checking your race before another bet.";
}
export default function BikeRacing() {
  const { user } = useAuth(),
    qc = useQueryClient(),
    sound = useStore((s) => s.settings.sound);
  const [venueId, setVenueId] = useState("apex"),
    [rules, setRules] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [assetsReady, setAssetsReady] = useState(false),
    [offset, setOffset] = useState(0),
    [now, setNow] = useState(Date.now());
  const [camera, setCamera] = useState(savedRaceCamera);
  const [focusBike, setFocusBike] = useState(1);
  const [autoCount, setAutoCount] = useState(5),
    [autoLeft, setAutoLeft] = useState(0),
    [recovering, setRecovering] = useState(false);
  const autoRef = useRef(0),
    lock = useRef(false),
    lastSlip = useRef<BikeSlip[]>([]),
    autoHandled = useRef(""),
    lastStarted = useRef("");
  const pending = useRef<{
    roundId: string;
    requestId: string;
    venueId: string;
    bets: BikeSlip[];
  } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const queryKey = ["bike-game-live", user?.id, venueId];
  const wallet = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        enabled: !!user,
        retry: false,
      },
    },
  );
  const config = useQuery<RacingConfig>({
    queryKey: ["bike-game-config"],
    queryFn: () => customFetch(endpoint + "/config"),
    staleTime: 60000,
  });
  const state = useQuery<State>({
    queryKey,
    queryFn: ({ signal }) =>
      customFetch(`${endpoint}/live?venueId=${venueId}`, { signal }),
    enabled: !!user,
    refetchInterval: busy ? false : 1000,
    refetchOnWindowFocus: !busy,
    retry: 1,
  });
  const race = state.data?.race ?? null,
    venue = racingVenue(venueId);
  const myBet = state.data?.myBet ?? null;
  const elapsed = race ? (now + offset - race.startedAt) / 1000 : 0;
  const phase = race ? bikeRoundPhase(race, now + offset) : "loading";
  const active = phase === "racing";
  const bettingSeconds = race ? Math.max(0, Math.ceil(-elapsed)) : 0;
  const nextSeconds = race
    ? Math.max(0, Math.ceil((race.nextRoundAt - now - offset) / 1000))
    : 0;
  const roundConfig = race?.config ?? config.data;
  const balance = wallet.data?.balance ?? state.data?.balance ?? "0";
  const maxStake = roundConfig?.maxStakePaise ?? "0";
  const coins = useCoinPreferences(
    "bike-racing",
    user?.id,
    config.data ? Number(BigInt(maxStake) / 100n) : Infinity,
  );
  const editable =
    !!user &&
    assetsReady &&
    !!config.data?.enabled &&
    !!roundConfig?.enabled &&
    !!state.data &&
    !state.isError &&
    phase === "betting" &&
    !myBet &&
    !busy &&
    !recovering;
  const draft = useChipDraft<string>(
    `${venueId}:${race?.id ?? "new"}`,
    editable,
    balance,
    maxStake,
  );
  const total = draft.bets.reduce((sum, b) => sum + BigInt(b.amountPaise), 0n);

  const [armed, setArmed] = useState(false);
  const selection = {
    seconds: armed ? Math.max(0, Math.ceil((race!.startedAt - offset - BET_SEND_BUFFER_MS - now) / 1000)) : null,
    cancel: () => setArmed(false), select: (_ready = false) => setArmed(true),
  };
  useTimedBet({
    roundKey: race?.id ?? null,
    deadline: race ? race.startedAt - offset - BET_SEND_BUFFER_MS : null,
    expiresAt: race ? race.startedAt - offset - 250 : null,
    armed: armed && draft.bets.length > 0,
    enabled: editable && !document.hidden,
    submit: () => void submit(),
  });
  useEffect(() => { setArmed(false); }, [race?.id]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
  }, [qc]);
  const stopAuto = () => {
    autoRef.current = 0;
    setAutoLeft(0);
    selection.cancel();
  };
  const cancel = () => {
    stopAuto();
    draft.clear();
    setError("");
  };
  useEffect(() => {
    document.title = "Bike Racing · Lunar Casino";
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!state.data) return;
    setOffset(state.data.serverNow - Date.now());
  }, [state.dataUpdatedAt]);
  useEffect(() => {
    if (myBet?.status === "finished" || state.data?.history[0]) invalidate();
  }, [myBet?.id, myBet?.status, state.data?.history[0]?.id, invalidate]);
  useEffect(() => {
    if (phase !== "betting") {
      selectionRef.current.cancel();
      draft.clear();
    }
  }, [phase]);
  useEffect(() => {
    if (state.isError || config.isError) {
      autoRef.current = 0;
      setAutoLeft(0);
      selectionRef.current.cancel();
    }
  }, [state.isError, config.isError]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        autoRef.current = 0;
        setAutoLeft(0);
        selectionRef.current.cancel();
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      autoRef.current = 0;
    };
  }, []);
  // A failed response can hide an accepted stake. Keep the same id for recovery.
  async function submit(retry = false) {
    if (
      lock.current ||
      (!retry && (!editable || !race || Date.now() + offset >= race.startedAt))
    )
      return;
    const bets = retry
      ? pending.current?.bets
      : draft.bets.map((b) => ({
          bikeId: Number(b.type),
          amountPaise: b.amountPaise,
        }));
    if (!bets?.length) return;
    const body = retry
      ? pending.current!
      : { requestId: crypto.randomUUID(), roundId: race!.id, venueId, bets };
    lock.current = true;
    setBusy(true);
    setError("");
    pending.current = body;
    try {
      // Cancel earlier polls so a pre-acceptance snapshot cannot erase this receipt.
      await qc.cancelQueries({ queryKey });
      const result = await customFetch<State>(endpoint + "/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      qc.setQueryData<State>(queryKey, result);
      if (sound) playGameSound("bet", "bike-racing");
      setOffset(result.serverNow - Date.now());
      lastSlip.current = body.bets;
      lastStarted.current = body.roundId;
      draft.clear();
      selection.cancel();
      pending.current = null;
      setRecovering(false);
      if (autoRef.current > 0) {
        autoRef.current--;
        setAutoLeft(autoRef.current);
      }
      invalidate();
      stage.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      stopAuto();
      setError(message(e));
      // Only explicit API rejections are safe to discard. Transport failures retain the id.
      const rejected =
        e instanceof ApiError && e.status >= 400 && e.status < 500;
      if (rejected) {
        pending.current = null;
        draft.clear();
        setRecovering(false);
      } else setRecovering(true);
      void state.refetch();
      invalidate();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !recovering ||
      !pending.current ||
      ![myBet, ...(state.data?.history ?? [])].some(
        (b) => b?.requestId === pending.current?.requestId,
      )
    )
      return;
    pending.current = null;
    setRecovering(false);
    draft.clear();
    setError("Your bet was recovered. The wallet was charged once.");
    invalidate();
  }, [myBet?.id, state.data?.history, recovering, invalidate]);
  useEffect(() => {
    if (
      !editable ||
      !race ||
      autoLeft <= 0 ||
      race.id === lastStarted.current ||
      !lastSlip.current.length ||
      autoHandled.current === race.id ||
      document.hidden
    )
      return;
    const timer = setTimeout(() => {
      if (autoRef.current <= 0 || document.hidden) return;
      autoHandled.current = race.id;
      const ok = draft.stage(
        lastSlip.current.map((b) => ({
          type: String(b.bikeId),
          amountPaise: b.amountPaise,
        })),
        true,
      );
      if (ok) selection.select(true);
      else {
        stopAuto();
        setError(
          "Auto bet stopped: check your wallet balance and table limits.",
        );
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [race?.id, autoLeft, editable]);
  function chooseBike(id: number) {
    unlockAudio();
    if (!race || Date.now() + offset >= race.startedAt - 300) return;
    setError("");
    if (
      draft.stage([
        { type: String(id), amountPaise: rupeesToPaise(coins.chip) },
      ])
    )
      selection.select(true);
    else setError("Not enough balance, or the table stake limit was reached.");
  }
  const receipts = useMemo(
    () =>
      myBet?.status === "finished"
        ? myBet.bets.map((b) => ({
            status: "settled" as const,
            totalStake: b.amountPaise,
            payoutAmount:
              b.bikeId === myBet.winnerId ? myBet.payoutAmount : "0",
          }))
        : [],
    [myBet],
  );
  const win = useRoundWin({
    game: "bike-racing",
    userId: user?.id,
    roundId: myBet?.roundId ?? null,
    eligible: myBet?.status === "finished",
    bets: receipts,
  });
  useBikeSound(sound, active, phase === "results", race?.id ?? "grid");
  return (
    <div className="game-page lucky7-game hr-game br-game" data-phase={phase}>
      <div className="game-shell">
        <header className="lucky7-header hr-header">
          <div className="hr-brand">
            <Link href="/" aria-label="Back to lobby">
              <ArrowLeft size={21} />
            </Link>
            <span className="hr-brand-mark">
              <Flag size={20} />
            </span>
            <div>
              <h1>BIKE RACING</h1>
              <small>APEX SUPERBIKE SERIES</small>
            </div>
          </div>
          <div className="hr-header-actions">
            <button
              onClick={() => {
                unlockAudio();
                updateSettings({ sound: !sound });
              }}
              aria-label={sound ? "Mute race sound" : "Enable race sound"}
              aria-pressed={sound}
            >
              {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button aria-label="Game information" data-testid="btn-game-rules" onClick={() => setRules(true)}>
              <Info size={20} />
            </button>
            <Link href="/wallet" aria-label="Open shared wallet">
              <Wallet size={20} />
            </Link>
          </div>
          <div className="lucky7-header-details">
            <p>Pick your bikes. Follow the race.</p>
            <Link href="/wallet" className="lucky7-wallet">
              <span>Balance</span>
              <strong data-testid="bike-wallet">
                ₹{formatRupees(balance)}
              </strong>
            </Link>
          </div>
        </header>
        <main className="lucky7-main hr-main">
          <div
            className="lucky7-table-column hr-table-column"
            data-game-screen="bike-racing"
          >
            <div className="hr-meeting">
              <div>
                <MapPin size={15} />
                <select
                  aria-label="Race location"
                  value={venueId}
                  disabled={busy || recovering}
                  onChange={(e) => {
                    cancel();
                    setVenueId(e.target.value);
                  }}
                >
                  {RACING_VENUES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.country}
                    </option>
                  ))}
                </select>
              </div>
              <span>
                {venue.distance.toLocaleString()}m <i /> {venue.laps}{" "}
                {venue.laps > 1 ? "laps" : "lap"} <i /> 6 bikes
              </span>
            </div>
            <div className="hr-stage-wrap" ref={stage}>
              <div className="hr-race-picture">
                <BikeRaceScene
                  race={race}
                  venueId={venueId}
                  serverOffset={offset}
                  camera={camera}
                  focusBike={focusBike}
                  selected={myBet ? myBet.bets.map(b => b.bikeId) : draft.bets.map(b => Number(b.type))}
                  phase={phase}
                  onReady={setAssetsReady}
                />
                <div className="hr-broadcast">
                  <span>
                    <i className={active ? "is-live" : ""} />
                    {phase === "betting" ? "BETTING OPEN" : active ? "ROUND IN PROGRESS" : phase === "results" ? "OFFICIAL RESULT" : "CONNECTING"}
                  </span>
                  <button
                    aria-label="Fullscreen race"
                    onClick={() => {
                      if (document.fullscreenElement)
                        void document.exitFullscreen();
                      else void stage.current?.requestFullscreen();
                    }}
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
                {phase === "betting" && (
                  <div className="hr-countdown">
                    <span>BETTING CLOSES IN</span>
                    <strong data-testid="bike-betting-countdown">
                      {bettingSeconds}s
                    </strong>
                  </div>
                )}
                <div className="hr-track-status">
                  <span>{venue.name.toUpperCase()}</span>
                  <span>
                    {active
                      ? `RACE TIMER ${Math.min(20, Math.max(0, elapsed)).toFixed(1)} / 20s`
                      : phase === "betting"
                        ? `STARTS IN ${bettingSeconds}s`
                        : phase === "results"
                          ? `NEXT BETTING IN ${nextSeconds}s`
                          : "CONNECTING"}
                  </span>
                </div>
                <div className="hr-progress">
                  <i
                    style={{
                      width: `${Math.min(1, Math.max(0, elapsed / 20)) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="hr-camera-controls" role="group" aria-label="Race camera">
                {RACE_CAMERAS.map(view => <button key={view.id} type="button" title={view.hint}
                  aria-pressed={camera === view.id} onClick={() => {
                    setCamera(view.id);
                    try { localStorage.setItem(CAMERA_STORAGE_KEY, view.id); } catch { /* Camera still works without storage. */ }
                  }}>{view.label}</button>)}
              </div>
              {camera === "closeup" && <div className="br-follow-bikes" role="group" aria-label="Follow a bike">
                <span>Follow bike</span>{RACING_BIKES.map(bike => <button key={bike.id} type="button"
                  aria-label={`Follow ${bike.name}`} aria-pressed={focusBike === bike.id}
                  style={{ borderColor: bike.color }} onClick={() => setFocusBike(bike.id)}>{bike.id}</button>)}
              </div>}
            </div>
            <section
              className="hr-betting-dock"
              data-testid="bike-betting-dock"
              data-live-bet-dock
            >
              {phase === "results" && race?.winnerId && (
                <div
                  className="hr-result-bar"
                  role="status"
                  data-testid="bike-result"
                >
                  <span>
                    <Trophy size={14} /> #{race.winnerId}{" "}
                    {RACING_BIKES[(race.winnerId ?? 1) - 1].name} wins
                  </span>
                  <strong>
                    {myBet?.status === "finished"
                      ? `Your return ₹${formatRupees(myBet.payoutAmount)}`
                      : `Next betting in ${nextSeconds}s`}
                  </strong>
                </div>
              )}
              <div className="hr-bet-heading">
                <span>
                  <Timer size={14} />
                  {busy
                    ? "CONFIRMING STAKE"
                    : myBet && phase === "betting"
                      ? `BET ACCEPTED / STARTS IN ${bettingSeconds}s`
                      : phase === "betting"
                        ? `PLACE BETS / ${bettingSeconds}s`
                        : phase === "results"
                          ? `NEXT BETTING IN ${nextSeconds}s`
                          : "BETS LOCKED"}
                </span>
                <strong>
                  {myBet
                    ? `₹${formatRupees(myBet.totalStake)} in play`
                    : `₹${formatRupees(total)} selected`}
                </strong>
              </div>
              <div className="hr-bike-grid game-bet-grid">
                {RACING_BIKES.map((h) => {
                  const stake = myBet
                    ? myBet.bets.find((b) => b.bikeId === h.id)?.amountPaise
                    : draft.bets.find((b) => b.type === String(h.id))
                        ?.amountPaise;
                  const won =
                    phase === "results" &&
                    !!race &&
                    race.winnerId === h.id &&
                    race.venueId === venueId;
                  return (
                    <button
                      key={h.id}
                      data-game-bet
                      data-testid={`bike-${h.id}`}
                      data-selected={!!stake}
                      data-winner={won}
                      disabled={!editable}
                      onClick={() => chooseBike(h.id)}
                      aria-label={`Bet on ${h.name}`}
                    >
                      <b
                        className="hr-bike-number"
                        style={{ background: h.color }}
                      >
                        {h.id}
                      </b>
                      <span>
                        <strong>{h.name}</strong>
                        <small>
                          {roundConfig?.bikes
                            .find((x) => x.id === h.id)
                            ?.multiplier.toFixed(2) ?? "—"}
                          × {stake && <em>· ₹{formatRupees(stake)}</em>}
                        </small>
                      </span>
                      {won && <Trophy className="hr-winning-bike" size={13} />}
                    </button>
                  );
                })}
              </div>
              <div className="hr-coins">
                <TableCoinRack
                  preferences={coins}
                  chip={coins.chip}
                  onSelect={coins.selectChip}
                  disabled={!editable}
                  layout="fit"
                  maxValue={Math.max(1, Number(BigInt(maxStake) / 100n))}
                />
              </div>
              <div className="hr-bet-actions">
                <AutoBetStatus
                  seconds={selection.seconds}
                  selected={selection.seconds !== null}
                  busy={busy}
                  onCancel={cancel}
                />
                <button
                  className="hr-repeat"
                  disabled={!editable || !lastSlip.current.length}
                  onClick={() => {
                    if (
                      draft.stage(
                        lastSlip.current.map((b) => ({
                          type: String(b.bikeId),
                          amountPaise: b.amountPaise,
                        })),
                        true,
                      )
                    )
                      selection.select(true);
                    else setError("Not enough balance to repeat the bet.");
                  }}
                >
                  <RotateCcw size={14} /> Repeat
                </button>
              </div>
              <div className="hr-auto-controls">
                <span>Auto play</span>
                <select
                  aria-label="Auto bet race count"
                  value={autoCount}
                  disabled={autoLeft > 0 || busy}
                  onChange={(e) => setAutoCount(Number(e.target.value))}
                >
                  {[5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      {n} races
                    </option>
                  ))}
                </select>
                {autoLeft > 0 ? (
                  <button className="hr-auto-stop" onClick={stopAuto}>
                    <X size={13} /> Stop auto · {autoLeft} left
                  </button>
                ) : (
                  <button
                    disabled={!editable || !draft.bets.length}
                    onClick={() => {
                      autoHandled.current = race?.id ?? "";
                      autoRef.current = autoCount;
                      setAutoLeft(autoCount);
                      selection.select(true);
                    }}
                  >
                    Start auto
                  </button>
                )}
                <small>1 coin = ₹1</small>
              </div>
              <p className="hr-bet-hint">
                {myBet && phase === "betting"
                  ? "Bet accepted. The live race starts when the shared timer reaches zero."
                  : active
                    ? "Betting is closed. Watch the live race; the next betting window opens after the result."
                    : phase === "results"
                      ? "The next 20-second betting window opens automatically."
                      : "Choose coins and bikes. Your selected slip is sent automatically at the end of the 20-second betting timer."}
              </p>
              {error && (
                <div className="hr-error" role="alert">
                  {error}
                  {recovering && (
                    <button disabled={busy} onClick={() => void submit(true)}>
                      Check / recover bet
                    </button>
                  )}
                </div>
              )}
              {(state.isError || config.isError) && (
                <div className="hr-error" role="alert">
                  Cannot connect to the race server.{" "}
                  <button
                    onClick={() => {
                      void state.refetch();
                      void config.refetch();
                    }}
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </section>
          </div>
          <GameInformationSection><aside className="hr-sidebar">
            <section>
              <h2>
                <Flag size={14} /> THE FIELD
              </h2>
              {RACING_BIKES.map((h) => (
                <div className="hr-field-row" key={h.id}>
                  <span className="br-bike-icon" aria-hidden="true"><img src={BIKE_PHOTO} alt="" /></span>
                  <b style={{ background: h.color }}>{h.id}</b>
                  <span>
                    {h.name}
                    <small>
                      {roundConfig?.bikes
                        .find((x) => x.id === h.id)
                        ?.multiplier.toFixed(2) ?? "—"}
                      × to win
                    </small>
                  </span>
                </div>
              ))}
            </section>
            <section>
              <h2>
                <Trophy size={14} /> MY RECENT RACES
              </h2>
              {state.data?.history?.length ? (
                state.data.history.slice(0, 5).map((r) => (
                  <div key={r.id} className="hr-history">
                    <span>
                      {RACING_BIKES[(r.winnerId ?? 1) - 1].name}
                      <small>{racingVenue(r.venueId).name}</small>
                    </span>
                    <strong data-won={BigInt(r.payoutAmount) > 0n}>
                      ₹{formatRupees(r.payoutAmount)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="hr-empty-history">
                  Your completed races will appear here.
                </p>
              )}
            </section>
          </aside></GameInformationSection>
        </main>
      </div>
      <RoundWinDialog win={win.win} onClose={win.dismiss} />
      <Dialog open={rules} onOpenChange={setRules}>
        <GameInformationDrawer onCloseAutoFocus={restoreGameInformationFocus}>
          <DialogHeader>
            <DialogTitle>Bike Racing</DialogTitle>
            <DialogDescription>
              Six superbikes. Automatic races. One shared wallet.
            </DialogDescription>
          </DialogHeader>
          <GameInformationTarget />
          <div className="hr-rules">
            <p>
              Six numbered superbikes race on the 3D circuit. Their colours and numbers
              match the betting entries. Race positions and the finish follow the shared
              server round. Camera and follow controls change your view of the race.
              The official result confirms the winner after the race ends.
            </p>
            <p>
              Select your coin and tap any bikes you want to back. Each tap
              adds the selected coin. Your selected slip submits automatically at the end of the 20-second betting window (sent a moment early for network travel). Cancel clears it.
            </p>
            <p>
              Every location runs continuous shared rounds, even without bets.
              Betting is open for 20 seconds, then locks for the entire race.
              After the 20-second race and a five-second result display, the next betting
              window opens automatically. Placing coins never starts or resets a
              race. Each round draws a new winning entry. All six bikes have the same chance to win. A winning bet
              returns stake × its displayed odds, including stake.
            </p>
            <p>
              Coins and balance are the same as the other games. Winnings settle
              on the server even if you close the page. Refresh resumes your
              live round.
            </p>
            <p>
              Auto play places your slip once in each new betting window, for
              the number of races you choose. It stops on errors, insufficient
              balance, leaving the page or switching to another tab. Stop auto
              prevents the next bet; it does not cancel an accepted race.
            </p>
          </div>
        </GameInformationDrawer>
      </Dialog>
    </div>
  );
}
