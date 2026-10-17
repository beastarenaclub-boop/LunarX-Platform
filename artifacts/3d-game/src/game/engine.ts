import { store, type Bet, type RoundResult, type CrashPanelIndex } from "./store";
import { setEngineConfig } from "./rng";
import {
  sfx,
  startMusic,
  stopMusic,
  setVolumes,
  unlockAudio,
  setUiNavAllowed,
  voiceRoundResult,
} from "./audio";
import { FAKE_NAMES, CHAT_LINES } from "./names";
import {
  ACHIEVEMENTS,
  LEVEL_REWARDS,
  levelFromTotalXp,
  rewardsForLevel,
  rollDailyMissions,
  type MissionInstance,
  type ProgressionState,
} from "./progression";
import { toast } from "sonner";
import {
  getCrashRound,
  type CrashSnapshot,
  placeServerBet,
  cashOutServerBet,
  settleServerLoss,
  settleServerRound,
} from "./serverBridge";

// Live, admin-controlled timings. These start at sensible defaults and are
// overwritten by `fetchAndApplyServerConfig` (initial REST pull) and
// `applyLiveGameConfig` (realtime push). The CURRENT round always uses the
// snapshot taken when it started; pendingLiveConfig is consumed at the start
// of the next round so changes never break an in-flight round.
interface LiveTimings {
  bettingMsNormal: number;
  bettingMsTurbo: number;
  interRoundDelayMs: number;
  // Hold time after a crash before the next betting phase. Mirrors
  // `interRoundDelayMs` for normal mode and is shortened in turbo to match the
  // historical 1500ms feel (60% of normal).
  holdMsNormal: number;
  holdMsTurbo: number;
}

const DEFAULT_TIMINGS: LiveTimings = {
  bettingMsNormal: 5000,
  bettingMsTurbo: 2500,
  interRoundDelayMs: 2500,
  holdMsNormal: 2500,
  holdMsTurbo: 1500,
};

let liveTimings: LiveTimings = { ...DEFAULT_TIMINGS };
// Staged config to apply at the boundary of the next round.
let pendingTimings: LiveTimings | null = null;

function timingsFromServer(payload: {
  bettingWindowMs?: number;
  turboBettingWindowMs?: number;
  interRoundDelayMs?: number;
}): LiveTimings {
  const bn = payload.bettingWindowMs ?? DEFAULT_TIMINGS.bettingMsNormal;
  const bt = payload.turboBettingWindowMs ?? DEFAULT_TIMINGS.bettingMsTurbo;
  const ir = payload.interRoundDelayMs ?? DEFAULT_TIMINGS.interRoundDelayMs;
  return {
    bettingMsNormal: bn,
    bettingMsTurbo: bt,
    interRoundDelayMs: ir,
    holdMsNormal: ir,
    // Keep the original 60%-of-normal turbo hold ratio so turbo stays snappy
    // even when an admin lengthens the inter-round delay.
    holdMsTurbo: Math.max(500, Math.round(ir * 0.6)),
  };
}

let raf: number | null = null;
let phaseTimer: ReturnType<typeof setTimeout> | null = null;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---- Progression ----------------------------------------------------------

type ProgressionEvent =
  | { type: "betPlaced" }
  | { type: "roundFinished" }
  | { type: "loss" }
  | { type: "win"; profit: number; multiplier: number; payout: number };

function updateMissions(
  missions: MissionInstance[],
  ev: ProgressionEvent,
): { next: MissionInstance[]; justCompleted: MissionInstance[] } {
  const justCompleted: MissionInstance[] = [];
  const next = missions.map((m) => {
    if (m.completed) return m;
    let inc = 0;
    switch (m.metric) {
      case "betsPlaced":
        if (ev.type === "betPlaced") inc = 1;
        break;
      case "wins":
        if (ev.type === "win") inc = 1;
        break;
      case "winsAt2x":
      case "winsAt5x":
      case "winsAt10x":
        if (ev.type === "win" && m.threshold && ev.multiplier >= m.threshold) inc = 1;
        break;
      case "profit":
        if (ev.type === "win") inc = Math.max(0, ev.profit);
        break;
      case "rounds":
        if (ev.type === "roundFinished") inc = 1;
        break;
      case "earlyCashouts":
        if (ev.type === "win" && m.threshold && ev.multiplier <= m.threshold) inc = 1;
        break;
    }
    if (inc <= 0) return m;
    const progress = Math.min(m.goal, m.progress + inc);
    const completed = progress >= m.goal;
    const nm = { ...m, progress, completed };
    if (completed && !m.completed) justCompleted.push(nm);
    return nm;
  });
  return { next, justCompleted };
}

function checkAchievements(p: ProgressionState): {
  next: ProgressionState;
  unlocked: typeof ACHIEVEMENTS;
} {
  const unlocked: typeof ACHIEVEMENTS = [];
  let xpFromAch = 0;
  const ach = { ...p.achievements };
  for (const a of ACHIEVEMENTS) {
    if (ach[a.id]) continue;
    let hit = false;
    switch (a.id) {
      case "first_bet":
        hit = p.stats.totalBets >= 1;
        break;
      case "first_win":
        hit = p.stats.totalWins >= 1;
        break;
      case "cashout_2x":
        hit = p.stats.biggestMultiplier >= 2;
        break;
      case "cashout_5x":
        hit = p.stats.biggestMultiplier >= 5;
        break;
      case "cashout_10x":
        hit = p.stats.biggestMultiplier >= 10;
        break;
      case "cashout_50x":
        hit = p.stats.biggestMultiplier >= 50;
        break;
      case "streak_3":
        hit = p.stats.bestConsecutiveWins >= 3;
        break;
      case "streak_5":
        hit = p.stats.bestConsecutiveWins >= 5;
        break;
      case "streak_10":
        hit = p.stats.bestConsecutiveWins >= 10;
        break;
      case "big_win_1k":
        hit = p.stats.biggestWinProfit >= 1000;
        break;
      case "big_win_10k":
        hit = p.stats.biggestWinProfit >= 10000;
        break;
      case "rounds_10":
        hit = p.stats.totalRounds >= 10;
        break;
      case "rounds_100":
        hit = p.stats.totalRounds >= 100;
        break;
      case "rounds_500":
        hit = p.stats.totalRounds >= 500;
        break;
      case "level_5":
        hit = p.level >= 5;
        break;
      case "level_10":
        hit = p.level >= 10;
        break;
      case "level_25":
        hit = p.level >= 25;
        break;
    }
    if (hit) {
      ach[a.id] = Date.now();
      xpFromAch += a.xp;
      unlocked.push(a);
    }
  }
  if (unlocked.length === 0) return { next: p, unlocked };
  const newTotal = p.totalXp + xpFromAch;
  const lvl = levelFromTotalXp(newTotal);
  return {
    next: {
      ...p,
      achievements: ach,
      totalXp: newTotal,
      xp: lvl.xp,
      level: lvl.level,
    },
    unlocked,
  };
}

function applyLevelRewards(p: ProgressionState, oldLevel: number): {
  next: ProgressionState;
  newRewards: ReturnType<typeof rewardsForLevel>;
} {
  if (p.level <= oldLevel) return { next: p, newRewards: [] };
  const newRewards: ReturnType<typeof rewardsForLevel> = [];
  let unlockedSkins = [...p.unlockedSkins];
  let unlockedTrails = [...p.unlockedTrails];
  for (let l = oldLevel + 1; l <= p.level; l++) {
    for (const r of rewardsForLevel(l)) {
      newRewards.push(r);
      if (r.kind === "skin" && !unlockedSkins.includes(r.value as typeof unlockedSkins[number])) {
        unlockedSkins.push(r.value as typeof unlockedSkins[number]);
      }
      if (r.kind === "trail" && !unlockedTrails.includes(r.value)) {
        unlockedTrails.push(r.value);
      }
    }
  }
  return { next: { ...p, unlockedSkins, unlockedTrails }, newRewards };
}

function ensureDailyMissions(p: ProgressionState): ProgressionState {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (
    !p.dailyMissionsRolledAt ||
    now - p.dailyMissionsRolledAt >= ONE_DAY ||
    p.dailyMissions.length === 0
  ) {
    return { ...p, dailyMissions: rollDailyMissions(now), dailyMissionsRolledAt: now };
  }
  return p;
}

function applyProgressionEvent(ev: ProgressionEvent) {
  store.setState((s) => {
    let p = ensureDailyMissions(s.progression);
    const stats = { ...p.stats };
    let xpEarned = 0;

    if (ev.type === "betPlaced") {
      stats.totalBets += 1;
      xpEarned += 1;
    } else if (ev.type === "roundFinished") {
      stats.totalRounds += 1;
    } else if (ev.type === "win") {
      stats.totalWins += 1;
      stats.consecutiveWins += 1;
      if (stats.consecutiveWins > stats.bestConsecutiveWins) {
        stats.bestConsecutiveWins = stats.consecutiveWins;
      }
      if (ev.profit > stats.biggestWinProfit) stats.biggestWinProfit = ev.profit;
      if (ev.multiplier > stats.biggestMultiplier) stats.biggestMultiplier = ev.multiplier;
      xpEarned += 5 + Math.max(0, Math.floor(ev.profit / 10));
    } else if (ev.type === "loss") {
      stats.totalLosses += 1;
      stats.consecutiveWins = 0;
      xpEarned += 1;
    }

    const { next: missionsAfter, justCompleted } = updateMissions(p.dailyMissions, ev);
    // NOTE: mission XP is granted only when the player claims the reward
    // via `claimMissionReward`. Do NOT add it to totalXp here.

    const oldLevel = p.level;
    const newTotal = p.totalXp + xpEarned;
    const lvl = levelFromTotalXp(newTotal);
    p = {
      ...p,
      stats,
      dailyMissions: missionsAfter,
      totalXp: newTotal,
      xp: lvl.xp,
      level: lvl.level,
    };

    // Check achievements (may add more XP and bump level again)
    const ac = checkAchievements(p);
    p = ac.next;

    const lr = applyLevelRewards(p, oldLevel);
    p = lr.next;

    // Toast notifications (deferred slightly so multiple events don't clobber)
    queueMicrotask(() => {
      // JetX shows cashout feedback in the flight scene; achievement banners
      // must not cover the live bet controls or player list.
      if (s.activeGameCode === "jetx") return;
      for (const m of justCompleted) {
        toast.success(`Mission complete: ${m.title}`, {
          description: `Claim +${m.xp} XP in the missions panel`,
        });
      }
      for (const a of ac.unlocked) {
        toast.success(`Achievement: ${a.title}`, { description: `${a.description} • +${a.xp} XP` });
      }
      if (s.settings.sound && ac.unlocked.length > 0) sfx.achievementUnlock();
      if (p.level > oldLevel) {
        toast.success(`Level Up! Lv ${p.level}`, {
          description:
            lr.newRewards.length > 0
              ? `Unlocked: ${lr.newRewards.map((r) => r.label).join(", ")}`
              : "Keep flying for more rewards.",
        });
        if (s.settings.sound) sfx.levelUp();
      }
    });

    return { progression: p };
  });
}

export function claimMissionReward(missionId: string) {
  store.setState((s) => {
    const m = s.progression.dailyMissions.find((x) => x.id === missionId);
    if (!m || !m.completed || m.claimed) return {};
    const newMissions = s.progression.dailyMissions.map((x) =>
      x.id === missionId ? { ...x, claimed: true } : x,
    );
    const oldLevel = s.progression.level;
    const newTotal = s.progression.totalXp + m.xp;
    const lvl = levelFromTotalXp(newTotal);
    let p: ProgressionState = {
      ...s.progression,
      dailyMissions: newMissions,
      totalXp: newTotal,
      xp: lvl.xp,
      level: lvl.level,
    };
    const ac = checkAchievements(p);
    p = ac.next;
    const lr = applyLevelRewards(p, oldLevel);
    p = lr.next;
    queueMicrotask(() => {
      toast.success(`Claimed ${m.xp} XP`);
      for (const a of ac.unlocked) {
        toast.success(`Achievement: ${a.title}`, { description: `${a.description} • +${a.xp} XP` });
      }
      if (s.settings.sound && ac.unlocked.length > 0) sfx.achievementUnlock();
      if (p.level > oldLevel) {
        toast.success(`Level Up! Lv ${p.level}`, {
          description:
            lr.newRewards.length > 0
              ? `Unlocked: ${lr.newRewards.map((r) => r.label).join(", ")}`
              : "Keep flying for more rewards.",
        });
        if (s.settings.sound) sfx.levelUp();
      }
    });
    return { progression: p };
  });
}

export { LEVEL_REWARDS };

// ---- Engine ----------------------------------------------------------------

// Multiplier growth rate (per second, exponential). 0.10 ≈ real Aviator pace:
// 1.5× at ~4s, 2× at ~7s, 10× at ~23s. Purely presentational — the crash
// point is derived independently, so slowing this only makes rounds last
// longer on screen; payouts and RTP are unchanged.
const GROWTH_RATE = 0.1;

function multiplierAt(ms: number): number {
  const t = ms / 1000;
  return Math.max(1, +Math.exp(GROWTH_RATE * t).toFixed(2));
}

export async function rotateServerSeed(newClientSeed?: string) {
  if (newClientSeed) store.setState({clientSeed:newClientSeed});
  toast.info("A fresh server seed is committed every round. Client seed changes apply next round.");
}
export function hasPendingRotation() { return false; }

// Background music is only allowed on game routes. The lobby/home and other
// non-game pages must stay silent on open, so EngineHost flips this flag based
// on the current route. Default false → a fresh page load (which always lands
// the engine first) never auto-starts music until we're actually in a game.
let musicRouteAllowed = false;

export function setMusicRouteAllowed(allowed: boolean) {
  // UI navigation ticks share the same game-route gate as background music:
  // hover/select sounds are silent on the lobby/home and other non-game pages.
  setUiNavAllowed(allowed);
  if (musicRouteAllowed === allowed) return;
  musicRouteAllowed = allowed;
  // Leaving a game also stops its engine ambience.
  if (!allowed) {
    sfx.engineStop();
  }
  settingsApplyVolumes();
}

// Existing game actions may retry audio, but opening a game already arms music.
export function notifyPlayStarted() {
  if (!musicRouteAllowed) return;
  settingsApplyVolumes();
}

function settingsApplyVolumes() {
  const { masterVolume, sfxVolume, musicVolume, uiVolume, sound, music } = store.getState().settings;
  // setVolumes ensures the AudioContext exists and resumes it if suspended,
  // so toggling Sound back on immediately re-applies the slider values
  // without the user needing to nudge a slider first.
  setVolumes(
    sound ? masterVolume : 0,
    sound ? sfxVolume : 0,
    music ? musicVolume : 0,
    sound ? uiVolume : 0,
  );
  if (music && sound && musicRouteAllowed) startMusic();
  else stopMusic();
}

// Outcomes and accepted auto-cashouts are owned by the server. The browser
// interpolates animation only; reconnects restore the same committed round.
let engineGeneration = 0;
let latestSnapshot: CrashSnapshot | null = null;
let snapshotReceivedAt = 0;
let engineRunning = false;

function syncCrashBets(snapshot: CrashSnapshot) {
  store.setState(st => {
    let myBets = st.myBets;
    let panels = st.panels;
    for (const receipt of snapshot.bets) {
      if (receipt.status === "voided") continue;
      const count = st.activeGameCode === "jetx" ? 4 : 2;
      if (!Number.isInteger(receipt.panel) || receipt.panel < 0 || receipt.panel >= count) continue;
      const panel = receipt.panel as CrashPanelIndex;
      if (!myBets.some(b => b.id === receipt.id)) myBets = [...myBets, {id:receipt.id, panel, amount:Number(receipt.stakeAmount)/100,
        autoCashOut:receipt.autoCashOut ?? null, cashedOutAt:null, payout:0, roundId:snapshot.id, ts:Date.now()}];
      const local = myBets.find(b => b.id === receipt.id)!;
      if (local.cashedOutAt === null) {
        const pendingBet = snapshot.phase === "betting";
        const pendingAmount = pendingBet ? local.amount : 0;
        const current = panels[panel];
        if (current.activeBetId !== receipt.id || current.pendingBet !== pendingBet || current.pendingAmount !== pendingAmount) {
          if (panels === st.panels) panels = [...panels] as typeof panels;
          panels[panel] = {...current, activeBetId:receipt.id, pendingBet, pendingAmount};
        }
      }
    }
    return {myBets: myBets === st.myBets ? myBets : myBets.slice(-200), panels};
  });
  for (const receipt of snapshot.bets) {
    if (receipt.status === "cashed_out") recordCashOut(receipt.id, receipt.multiplier ?? 1, Number(receipt.payoutAmount)/100);
  }
}

async function startBettingPhase() {
  const generation = ++engineGeneration;
  const gameCode = store.getState().activeGameCode;
  latestSnapshot = null;
  if (phaseTimer) clearTimeout(phaseTimer);
  if (raf) cancelAnimationFrame(raf);
  store.setState({phase:"crashed", countdownMs:0, roundId:"connecting"});
  const poll = async (roundId?: string): Promise<void> => {
    try {
      const snapshot = await getCrashRound(gameCode, roundId);
      if (generation !== engineGeneration || !engineRunning) return;
      const first = !latestSnapshot;
      latestSnapshot = snapshot;
      snapshotReceivedAt = performance.now();
      const previous = store.getState();
      if (first) store.setState({roundId:snapshot.id, phase:snapshot.phase === "crashed" ? "flying" : snapshot.phase,
        multiplier:snapshot.multiplier, countdownTotalMs:snapshot.bettingMs, crashAt:0, flyMs:0,
        serverSeed:"", serverSeedHash:snapshot.serverSeedHash, clientSeed:snapshot.clientSeed, nonce:snapshot.nonce,
        liveBets:[], panels:previous.panels.map(p=>({...p,activeBetId:null,pendingBet:false,pendingAmount:0})) as typeof previous.panels});
      syncCrashBets(snapshot);
      if (snapshot.phase === "crashed") {
        store.setState({serverSeed:snapshot.serverSeed ?? "",crashAt:snapshot.crashPoint!});
        finishRound(snapshot.crashPoint!, {serverSeed:snapshot.serverSeed!,serverSeedHash:snapshot.serverSeedHash,clientSeed:snapshot.clientSeed,nonce:snapshot.nonce}, Math.max(100,(snapshot.nextRoundAt ?? snapshot.now)-snapshot.now), gameCode !== "fury" || !first);
        return;
      }
      store.setState({phase:snapshot.phase});
      if (snapshot.phase === "flying" && previous.phase !== "flying" && previous.settings.sound && musicRouteAllowed) {
        // Joining an ongoing Fury flight should resume its engine, not replay
        // a takeoff that happened before this page connected.
        if (gameCode !== "fury" || (!first && snapshot.now - snapshot.startsAt < 1400)) sfx.takeoff(gameCode);
        sfx.engineStart(gameCode);
      }
      if (first) {
        const animate = () => {
          if (generation !== engineGeneration || !latestSnapshot) return;
          const now = latestSnapshot.now + Math.min(500, performance.now()-snapshotReceivedAt);
          if (latestSnapshot.phase === "betting") {
            store.setState({countdownMs:Math.max(0,latestSnapshot.startsAt-now)});
            // The helicopter is already running while the countdown ticks;
            // the same source carries into flight without restarting.
            if (gameCode === "fury" && store.getState().settings.sound && musicRouteAllowed) sfx.engineIntensity(1, 0, gameCode);
          }
          else {
            const flyMs = Math.max(0,now-latestSnapshot.startsAt), multiplier = Math.floor(Math.exp(flyMs/10000)*100)/100;
            store.setState({multiplier,flyMs});
            if (store.getState().settings.sound && musicRouteAllowed) sfx.engineIntensity(multiplier, flyMs, gameCode);
          }
          raf=requestAnimationFrame(animate);
        };
        raf=requestAnimationFrame(animate);
        if (snapshot.phase === "betting") store.getState().panels.forEach((p,i)=>{
          if (i < (gameCode === "jetx" ? 4 : 2) && p.autoBet.enabled && p.autoBet.roundsLeft>0 && !p.pendingBet) void placeBet(i as CrashPanelIndex);
        });
      }
      phaseTimer=setTimeout(()=>void poll(snapshot.id),250);
    } catch {
      if (generation === engineGeneration && engineRunning) phaseTimer=setTimeout(()=>void poll(roundId),1000);
    }
  };
  await poll();
}

function finishRound(
  crashAt: number,
  roundCtx: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number },
  serverHold?: number,
  playResultAudio = true,
) {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  const s = store.getState();

  // Force-lose any active bets that didn't cash out
  let lossesThisRound = 0;
  const finalPanels = s.panels.map((p) => {
    if (p.activeBetId) {
      lossesThisRound += 1;
      const lostBet = s.myBets.find((b) => b.id === p.activeBetId);
      const lostStake = lostBet?.amount ?? p.amount;
      // Tell the server this bet ended without a cashout. Fire-and-forget so
      // the local round can settle even if the network is slow.
      void settleServerLoss(p.activeBetId, crashAt).catch((err: Error) => {
        // Surface a quiet warning but don't block the UI: the server may
        // already consider the bet placed/voided.
        console.warn("settleLoss failed:", err.message);
      });
      // mark bet payout = 0
      store.setState((st) => ({
        myBets: st.myBets.map((b) =>
          b.id === p.activeBetId
            ? { ...b, multiplier: crashAt, payout: 0 }
            : b,
        ),
      }));
      // Auto bet bookkeeping (use ACTUAL settled stake)
      const newAuto = p.autoBet.enabled
        ? {
            ...p.autoBet,
            roundsLeft: p.autoBet.roundsLeft - 1,
            runningProfit: p.autoBet.runningProfit - lostStake,
          }
        : p.autoBet;
      // After this loss, balance is unchanged (stake was already deducted at placeBet).
      const projectedBalance = s.balance;
      const stillRunning =
        newAuto.enabled &&
        newAuto.roundsLeft > 0 &&
        (!newAuto.stopOnLoss || -newAuto.runningProfit < newAuto.stopOnLoss) &&
        (!newAuto.stopOnWin || newAuto.runningProfit < newAuto.stopOnWin) &&
        (!newAuto.stopOnBalanceBelow || projectedBalance > newAuto.stopOnBalanceBelow) &&
        (!newAuto.stopOnBalanceAbove || projectedBalance < newAuto.stopOnBalanceAbove) &&
        projectedBalance >= p.amount;
      return {
        ...p,
        activeBetId: null,
        autoBet: { ...newAuto, enabled: stillRunning },
      };
    }
    // Update auto bet for panels with no bet (e.g. ran out)
    return p;
  }) as typeof s.panels;

  // Annotate myBets for this round with crash multiplier
  store.setState((st) => ({
    myBets: st.myBets.map((b) =>
      b.roundId === s.roundId && b.multiplier === undefined
        ? { ...b, multiplier: crashAt }
        : b,
    ),
  }));

  // Record round using the fairness snapshot captured at round start, NOT
  // current global state (which may have changed if rotation was attempted).
  const round: RoundResult = {
    houseEdge: latestSnapshot?.houseEdge,
    maxMultiplier: latestSnapshot?.maxMultiplier,
    id: s.roundId,
    crashAt,
    serverSeed: roundCtx.serverSeed,
    serverSeedHash: roundCtx.serverSeedHash,
    clientSeed: roundCtx.clientSeed,
    nonce: roundCtx.nonce,
    ts: Date.now(),
  };

  store.setState((st) => ({
    phase: "crashed",
    multiplier: crashAt,
    history: [crashAt, ...st.history].slice(0, 50),
    rounds: [round, ...st.rounds].slice(0, 50),
    pastSeeds: roundCtx.serverSeed ? [...st.pastSeeds.filter(p=>p.hash!==roundCtx.serverSeedHash), {seed:roundCtx.serverSeed,hash:roundCtx.serverSeedHash,rotatedAt:Date.now()}].slice(-10) : st.pastSeeds,
    panels: finalPanels,
    nonce: st.nonce + 1,
  }));

  // Always stop the plane-engine hum at round end — even when sound is muted,
  // the (silent) nodes would otherwise keep running forever and reappear when
  // sound is toggled back on mid-betting.
  sfx.engineStop();
  // Crash bang is route-gated too: silent when the round finishes while the
  // player is on the lobby/home or any other non-game page.
  if (playResultAudio && s.settings.sound && musicRouteAllowed) sfx.crash(s.activeGameCode);
  // The crash-result recording is optional until the approved licensed clip
  // is supplied; the audio service deliberately no-ops when it is absent.
  if (playResultAudio && s.settings.sound && musicRouteAllowed) {
    voiceRoundResult(s.activeGameCode as Parameters<typeof voiceRoundResult>[0], s.roundId, "crash-result");
  }

  // Trigger pari-mutuel round settlement on the server. Idempotent on
  // (roundId, gameCode), so it's safe even if multiple tabs / players race
  // to call it; only the first call actually splits the pool. Fire-and-forget
  // — the wallet refresh inside settleServerRound handles UI updates once
  // the server credits any deferred winnings.
  //
  // Only call when this client actually placed a server bet in this round:
  // rounds with no server bets would 404 on the server ("round has no
  // bets"), producing pointless error traffic every idle/spectator round.
  const hadServerBets =
    lossesThisRound > 0 || s.myBets.some((b) => b.roundId === s.roundId);
  if (hadServerBets && !s.roundId.startsWith("crash-")) void settleServerRound(s.roundId);

  // Progression events: round finished, plus one loss event per active bet that
  // didn't cash out before the crash.
  applyProgressionEvent({ type: "roundFinished" });
  for (let i = 0; i < lossesThisRound; i++) {
    applyProgressionEvent({ type: "loss" });
  }

  // Hold "crashed" briefly, then start next round. Uses the SAME snapshot of
  // live timings that was active when this round started so an admin edit
  // doesn't suddenly stretch/shrink the inter-round pause mid-flight.
  const hold = s.settings.turbo
    ? liveTimings.holdMsTurbo
    : liveTimings.holdMsNormal;
  phaseTimer && clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    startBettingPhase();
  }, serverHold ?? hold);
}

// Track in-flight server placements so a panel cannot double-submit while the
// server call is pending. Server bet ids land back in panel.activeBetId.
const placingPanels: Set<number> = new Set();

export async function placeBet(panelIdx: CrashPanelIndex) {
  const s = store.getState();
  const p = s.panels[panelIdx];
  if (panelIdx > 1 && s.activeGameCode !== "jetx") return;
  if (s.phase !== "betting" || !s.roundId.startsWith("crash-")) return;
  if (s.gameDisabled) {
    toast.error("Game is temporarily disabled");
    return;
  }
  if (p.pendingBet || p.activeBetId) return;
  // Free bet: stake is the fixed grant amount decided by the server; the
  // local amount input is ignored and no wallet balance is needed.
  const useFreeBet = s.useFreeBetForBets && s.freeBetCount > 0;
  const freeBetStake = useFreeBet
    ? Math.round(Number(s.freeBetNextAmountPaise)) / 100
    : 0;
  if (!useFreeBet && p.amount <= 0) return;
  if (useFreeBet && freeBetStake <= 0) return;
  if (placingPanels.has(panelIdx)) return;
  placingPanels.add(panelIdx);
  if (s.settings.sound) sfx.bet();
  // Optimistically reserve the stake locally so the panel UI flips to its
  // "Cancel"/"Cash out" affordance immediately. The server is the source of
  // truth for the wallet balance — it is debited inside placeServerBet.
  const reserved = useFreeBet ? freeBetStake : p.amount;
  store.setState({
    panels: s.panels.map((pp, i) =>
      i === panelIdx ? { ...pp, pendingBet: true, pendingAmount: reserved } : pp,
    ) as typeof s.panels,
  });
  try {
    const serverBet = await placeServerBet(reserved, {
      useBonus: store.getState().useBonusForBets,
      useFreeBet,
      panel: panelIdx,
      autoCashOut: p.autoCashOutEnabled ? p.autoCashOut : undefined,
    });
    if (useFreeBet) {
      // Consumed one grant — refresh the summary so the toggle/count update.
      void import("./freeBets").then((m) => m.refreshFreeBets());
    }
    if (store.getState().roundId !== s.roundId) return;
    // Stash the server bet id on the panel as activeBetId so cashOut/lose
    // calls have the right reference even though the local round hasn't
    // started flying yet.
    store.setState((st) => ({
      panels: st.panels.map((pp, i) =>
        i === panelIdx ? { ...pp, activeBetId: serverBet.id } : pp,
      ) as typeof st.panels,
    }));
    applyProgressionEvent({ type: "betPlaced" });
    // Player has actually started playing → background music may now begin.
    notifyPlayStarted();
  } catch (err) {
    if (store.getState().roundId !== s.roundId) return;
    // Roll the panel back to idle and surface the failure to the user.
    store.setState((st) => ({
      panels: st.panels.map((pp, i) =>
        i === panelIdx
          ? { ...pp, pendingBet: false, pendingAmount: 0, activeBetId: null }
          : pp,
      ) as typeof st.panels,
    }));
    const msg = (err as Error).message || "Failed to place bet";
    toast.error(msg);
  } finally {
    placingPanels.delete(panelIdx);
  }
}

export function cancelBet(panelIdx: CrashPanelIndex) {
  const s = store.getState();
  const p = s.panels[panelIdx];
  if (!p.pendingBet || s.phase !== "betting") return;
  // Server bets are committed at /bets/place — once accepted they cannot be
  // canceled. We allow cancel only while the server placement is still in
  // flight (no activeBetId yet), in which case there is nothing to refund.
  if (p.activeBetId || placingPanels.has(panelIdx)) {
    toast.info("Bet already placed on server — cash out when flying instead.");
    return;
  }
  store.setState({
    panels: s.panels.map((pp, i) =>
      i === panelIdx ? { ...pp, pendingBet: false, pendingAmount: 0 } : pp,
    ) as typeof s.panels,
  });
  if (s.settings.sound) sfx.click();
}

const cashingOut = new Set<string>();
export async function cashOut(panelIdx: CrashPanelIndex, atMultiplier?: number) {
  const s=store.getState(), id=s.panels[panelIdx].activeBetId;
  if (s.phase!=="flying" || !id || cashingOut.has(id)) return;
  cashingOut.add(id);
  try {
    const receipt=await cashOutServerBet(id,atMultiplier ?? s.multiplier);
    recordCashOut(id,receipt.multiplier ?? atMultiplier ?? s.multiplier,Number(receipt.payoutAmount)/100);
  } catch(error) { toast.error(`Cash out failed: ${(error as Error).message}`); }
  finally { cashingOut.delete(id); }
}

function recordCashOut(id: string, m: number, payout: number) {
  const s=store.getState(), bet=s.myBets.find(b=>b.id===id);
  if (!bet || bet.cashedOutAt!==null) return;
  const panelIdx=bet.panel;
  store.setState((st) => {
    const updatedPanels = st.panels.map((pp, i) =>
      i === panelIdx && pp.activeBetId === id
        ? {
            ...pp,
            activeBetId: null, pendingBet:false, pendingAmount:0,
            autoBet: pp.autoBet.enabled
              ? (() => {
                  const newRoundsLeft = pp.autoBet.roundsLeft - 1;
                  const newProfit = pp.autoBet.runningProfit + (payout - bet.amount);
                  // Wallet-balance stop conditions are evaluated against the
                  // server balance asynchronously; here we only honor profit
                  // and round-count stops to avoid stale local-balance reads.
                  const stillRunning =
                    newRoundsLeft > 0 &&
                    (!pp.autoBet.stopOnLoss || -newProfit < pp.autoBet.stopOnLoss) &&
                    (!pp.autoBet.stopOnWin || newProfit < pp.autoBet.stopOnWin);
                  return {
                    ...pp.autoBet,
                    enabled: stillRunning,
                    roundsLeft: newRoundsLeft,
                    runningProfit: newProfit,
                  };
                })()
              : pp.autoBet,
          }
        : pp,
    ) as typeof st.panels;
    // Append big personal wins to the global leaderboard (>= 2x and payout >= 100)
    const profit = payout - bet.amount;
    const shouldRecord = m >= 2 && payout >= 100;
    const newTopWins = shouldRecord
      ? [
          ...st.topWins,
          {
            id: bet.id,
            name: "You",
            multiplier: m,
            amount: bet.amount,
            payout,
            ts: Date.now(),
            isMe: true,
          },
        ]
          .sort((a, b) => b.payout - a.payout)
          .slice(0, 100)
      : st.topWins;
    void profit;
    return {
      myBets: st.myBets.map((b) =>
        b.id === bet.id ? { ...b, cashedOutAt: m, payout, multiplier: st.crashAt } : b,
      ),
      panels: updatedPanels,
      topWins: newTopWins,
    };
  });
  if (s.settings.sound) sfx.cashout();
  applyProgressionEvent({
    type: "win",
    profit: +(payout - bet.amount).toFixed(2),
    multiplier: m,
    payout,
  });
}

export function setPanelAmount(panelIdx: CrashPanelIndex, amount: number) {
  store.setState((s) => ({
    panels: s.panels.map((pp, i) =>
      i === panelIdx ? { ...pp, amount: Math.max(1, Math.round(amount * 100) / 100) } : pp,
    ) as typeof s.panels,
  }));
}

export function setPanelAutoCash(panelIdx: CrashPanelIndex, enabled: boolean, value?: number) {
  store.setState((s) => {
    // Clamp to the live admin-controlled bounds so a player can't pick a
    // multiplier outside the band the server would accept.
    const lo = Math.max(1.01, s.autoCashoutMin);
    const hi = Math.max(lo, s.autoCashoutMax);
    return {
      panels: s.panels.map((pp, i) =>
        i === panelIdx
          ? {
              ...pp,
              autoCashOutEnabled: enabled,
              autoCashOut:
                value !== undefined
                  ? Math.min(hi, Math.max(lo, value))
                  : Math.min(hi, Math.max(lo, pp.autoCashOut)),
            }
          : pp,
      ) as typeof s.panels,
    };
  });
}

export function setAutoBet(
  panelIdx: CrashPanelIndex,
  cfg: Partial<{
    enabled: boolean;
    rounds: number;
    stopOnWin: number;
    stopOnLoss: number;
    stopOnBalanceBelow: number;
    stopOnBalanceAbove: number;
  }>,
) {
  store.setState((s) => ({
    panels: s.panels.map((pp, i) =>
      i === panelIdx
        ? {
            ...pp,
            autoBet: {
              ...pp.autoBet,
              ...cfg,
              roundsLeft: cfg.enabled ? cfg.rounds ?? pp.autoBet.rounds : pp.autoBet.roundsLeft,
              runningProfit: cfg.enabled ? 0 : pp.autoBet.runningProfit,
            },
          }
        : pp,
    ) as typeof s.panels,
  }));
}

export function updateSettings(patch: Partial<import("./store").Settings>) {
  store.setState((s) => ({ settings: { ...s.settings, ...patch } }));
  settingsApplyVolumes();
}

export function sendChat(text: string) {
  if (!text.trim()) return;
  const msg = {
    id: uid(),
    name: "You",
    text: text.slice(0, 140),
    ts: Date.now(),
    isMe: true,
  };
  store.setState((s) => ({ chat: [...s.chat, msg].slice(-100) }));
}

// Background fake chat & player joins
let atmosphereInterval: ReturnType<typeof setInterval> | null = null;
function startAtmosphere() {
  if (atmosphereInterval) clearInterval(atmosphereInterval);
  let i = 0;
  atmosphereInterval = setInterval(() => {
    if (Math.random() < 0.5) return;
    const name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
    const text = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
    store.setState((s) => ({
      chat: [...s.chat, { id: uid() + i++, name, text, ts: Date.now() }].slice(-100),
    }));
  }, 4000);
}

// Smooth random walk for online-player counter, clamped to a believable range.
let onlinePlayersInterval: ReturnType<typeof setInterval> | null = null;
const ONLINE_MIN = 800;
const ONLINE_MAX = 1500;
function startOnlinePlayersSim() {
  if (onlinePlayersInterval) clearInterval(onlinePlayersInterval);
  // Seed an initial value within the plausible range on each session start.
  store.setState((s) => ({
    onlinePlayers:
      s.onlinePlayers >= ONLINE_MIN && s.onlinePlayers <= ONLINE_MAX
        ? s.onlinePlayers
        : Math.round(ONLINE_MIN + Math.random() * (ONLINE_MAX - ONLINE_MIN)),
  }));
  onlinePlayersInterval = setInterval(() => {
    store.setState((s) => {
      // Mean-reverting random walk toward the midpoint so it doesn't drift off.
      const mid = (ONLINE_MIN + ONLINE_MAX) / 2;
      const pull = (mid - s.onlinePlayers) * 0.02;
      const noise = (Math.random() - 0.5) * 14;
      const next = Math.max(
        ONLINE_MIN,
        Math.min(ONLINE_MAX, Math.round(s.onlinePlayers + pull + noise)),
      );
      return { onlinePlayers: next };
    });
  }, 2500);
}

interface PublicGameConfig {
  gameCode?: string;
  houseEdge?: number;
  maxMultiplier?: number;
  enabled?: boolean;
  bettingWindowMs?: number;
  turboBettingWindowMs?: number;
  interRoundDelayMs?: number;
  minAutoCashout?: number;
  maxAutoCashout?: number;
  maxStakePaise?: string;
}

/**
 * Apply a fresh game config payload from the server. Used by both the
 * initial REST pull and the realtime `game-config:lunar` push handler.
 *
 * Timings are STAGED — they take effect at the next round boundary so the
 * current round's countdown doesn't visibly jump. Disabled flag and auto-cash
 * bounds apply immediately because they affect what the player can do RIGHT
 * NOW (place bets, pick an auto-cashout value).
 */
export function applyLiveGameConfig(cfg: PublicGameConfig) {
  // Test/diagnostics hook: record which game's config was last applied so
  // stale-apply incidents (config for game A applied while game B is active)
  // are observable from e2e tests and the browser console.
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__lastAppliedGameConfig = {
      gameCode: cfg.gameCode ?? store.getState().activeGameCode,
      activeGameCode: store.getState().activeGameCode,
      at: Date.now(),
    };
  }
  setEngineConfig({
    houseEdge: cfg.houseEdge,
    maxMultiplier: cfg.maxMultiplier,
  });
  pendingTimings = timingsFromServer(cfg);

  store.setState((s) => {
    const lo =
      cfg.minAutoCashout !== undefined
        ? Math.max(1.01, cfg.minAutoCashout)
        : s.autoCashoutMin;
    const hi =
      cfg.maxAutoCashout !== undefined
        ? Math.max(lo, cfg.maxAutoCashout)
        : Math.max(lo, s.autoCashoutMax);
    // Re-clamp existing auto-cash values so a tightened band doesn't leave
    // a panel pointing at an out-of-range value the server would reject.
    const panels = s.panels.map((pp) => ({
      ...pp,
      autoCashOut: Math.min(hi, Math.max(lo, pp.autoCashOut)),
    })) as typeof s.panels;
    const maxStakeRupees =
      cfg.maxStakePaise !== undefined && Number.isFinite(Number(cfg.maxStakePaise))
        ? Math.round(Number(cfg.maxStakePaise)) / 100
        : s.maxStakeRupees;
    return {
      gameDisabled: cfg.enabled === false,
      autoCashoutMin: lo,
      autoCashoutMax: hi,
      maxStakeRupees,
      panels,
    };
  });
}

async function fetchAndApplyServerConfig(
  gameCode: string = store.getState().activeGameCode,
) {
  try {
    const base = (import.meta as { env?: { VITE_API_URL?: string; BASE_URL?: string } }).env;
    const apiBase = base?.VITE_API_URL || "/api";
    const res = await fetch(`${apiBase}/game/config/${gameCode}/public`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const cfg = (await res.json()) as PublicGameConfig;
    // Guard against stale responses: if the active game changed while this
    // request was in flight (rapid route switches), drop the result so an
    // older game's config can never overwrite the current game's config.
    if (store.getState().activeGameCode !== gameCode) return;
    applyLiveGameConfig(cfg);
    // For the very first load also adopt timings immediately so the first
    // betting window matches the configured value (no pending defer needed).
    if (pendingTimings) {
      liveTimings = pendingTimings;
      pendingTimings = null;
    }
  } catch {
    // Configuration retries leave the server in charge of accepted round terms.
  }
}

/**
 * Switch the shared crash engine to a different crash game (lunar, aviator,
 * jetx, ...). Called by each crash page on mount. Clears round history and
 * live bets (they belong to the previous game's rounds) and re-pulls that
 * game's server config so RTP/house edge and timing match what the server
 * uses to settle bets for that gameCode.
 */
export function setActiveCrashGame(gameCode: string) {
  if (store.getState().activeGameCode === gameCode) return;
  store.setState({
    activeGameCode: gameCode,
    // Auto play was authorised for the previous game. Never carry it into
    // another game's first round, including the two hidden JetX panels.
    panels: store.getState().panels.map(p => ({ ...p, autoBet: { ...p.autoBet, enabled: false } })) as ReturnType<typeof store.getState>["panels"],
    history: [],
    rounds: [],
    liveBets: [],
    realLiveBetsActive: false,
    lastRealBetTs: 0,
  });
  void fetchAndApplyServerConfig(gameCode);
  if (engineRunning) void startBettingPhase();
}

export function initEngine() {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    engineRunning = true;
    settingsApplyVolumes();
    // Pull live game config (house edge, max multiplier) so the client engine
    // mirrors what the server uses to settle bets. Fire-and-forget; defaults
    // are safe if the request fails.
    void fetchAndApplyServerConfig();
    // Roll daily missions if needed (also re-rolls after 24h)
    store.setState((s) => ({ progression: ensureDailyMissions(s.progression) }));
    startBettingPhase();
    startAtmosphere();
    startOnlinePlayersSim();
  };

  // Wait for first user gesture for audio unlock, but begin game immediately
  start();

  return () => {
    engineRunning = false;
    engineGeneration++;
    if (raf) cancelAnimationFrame(raf);
    if (phaseTimer) clearTimeout(phaseTimer);
    if (atmosphereInterval) clearInterval(atmosphereInterval);
    if (onlinePlayersInterval) clearInterval(onlinePlayersInterval);
    // Kill the plane-engine hum on teardown (HMR/unmount mid-flight) so it
    // can't keep droning after the engine host is gone.
    sfx.engineStop();
    raf = null;
    phaseTimer = null;
    atmosphereInterval = null;
    onlinePlayersInterval = null;
    started = false;
  };
}

export { multiplierAt };
