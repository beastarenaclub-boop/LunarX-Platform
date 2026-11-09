import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { COIN, IMG, SPRITE_SIZE, TITLE_FRAMES } from "./assets";
import { BetChart } from "./BetChart";
import { SpinStage } from "./SpinStage";
import {
  BUTTON_LABELS,
  CANVAS_H,
  CANVAS_W,
  CHIPS,
  CHIP_SLOTS,
  COLORS,
  HUD_SLOTS,
  OPEN_SCALE,
  PANEL_BACKING,
  PANEL_MS,
  TABLE_SLOT,
  TAKE_LIT,
  TAKE_TOUCH,
  TEXT_STRETCH,
  TEXT_ZONES,
  TIMER_FLASH,
  TITLE_ZONE,
  at,
  chipRingRect,
  fontStack,
  glyphScaleX,
  lerpRect,
  type ChipValue,
  type Rect,
  type TextZone,
} from "./layout";
import { easeInOut } from "./geometry";
import {
  useRouletteGame,
  PAISE_PER_POINT,
  minStakePaiseOf,
} from "./useRouletteGame";
import { rouletteSounds, warmUpRouletteSounds } from "./sounds";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { pocketColor, pocketLabel, type Wheel } from "./wheelSpec";
import { applyViewport } from "./viewport";
import "./fonts.css";

/**
 * The game screen.
 *
 * ONE fixed 2316 x 1080 canvas, stretched to the window with no letterbox.
 * Every child is absolutely positioned in design pixels; nothing here is
 * responsive in the usual sense, because the cabinet it copies is not.
 *
 * The wheel is the single exception and is counter-scaled to stay circular.
 */
export function RouletteScreen({
  wheel,
  embedded = false,
}: {
  wheel: Wheel;
  /**
   * True inside a partner's iframe.
   *
   * Everything about the GAME is identical on both surfaces and must stay that
   * way. What this gates is OUR navigation chrome, which does not belong in
   * somebody else's page: a redirect to our login form and an exit to our
   * lobby. The crash game has made the same distinction since it shipped; the
   * two wheels simply never received the flag.
   */
  embedded?: boolean;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  /**
   * The player's Sound setting, which these two screens were ignoring entirely.
   *
   * Baccarat, blackjack, teen patti and lucky 7 all read it before playing
   * anything; the wheels never imported the store, so turning sound off left
   * the chip clicks, the clock tick, the seven-second wheel recording and the
   * win and lose stings playing.
   *
   * Driven through the module's own mute, which was written for this and called
   * by nothing. One effect covers every cue in the game, including the ones the
   * spin stage plays, because the flag is module-level — the alternative was
   * threading a condition through a dozen call sites and missing one.
   */
  const sound = useStore((st) => st.settings.sound);
  useEffect(() => {
    if (sound) rouletteSounds.unmute();
    else rouletteSounds.muteAll();
  }, [sound]);

  /**
   * Backgrounding cuts every clip, and nothing resumes on return.
   *
   * `muteAll` was written for exactly this and had one caller — the Sound
   * setting — so a backgrounded tab kept the seven-second wheel recording
   * playing and, worse, kept the drain's LOOPING rattle going while the
   * browser throttled its timer to once a second: a ticker running for tens of
   * seconds against a meter that had stopped moving. On return only new
   * triggers sound, which is why this re-applies the setting rather than
   * calling `unmute` unconditionally — a player with sound off must stay off.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) rouletteSounds.muteAll();
      else if (sound) rouletteSounds.unmute();
    };
    document.addEventListener("visibilitychange", onVisibility);
    globalThis.addEventListener("pagehide", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      globalThis.removeEventListener("pagehide", onVisibility);
    };
  }, [sound]);

  useEffect(() => {
    // Framed, a session expiring mid-game would push the PARTNER's iframe to
    // our sign-in page. Their player is not our player and has nowhere to sign
    // in to; the frame just has to stop being ours.
    if (!embedded && !authLoading && !user) navigate("/");
  }, [embedded, authLoading, user, navigate]);

  useEffect(() => {
    document.title = `${wheel.title} • Lunar Casino`;
  }, [wheel.title]);

  /**
   * The screen does not time out (parity spec 13 §3.2).
   *
   * A cabinet's screen never sleeps, and a player watching a wheel is not
   * touching anything — so the display timeout switched the screen off
   * mid-round and the result landed on a dark screen. The cabinet sets an
   * Android window flag; the web's one tool is the Screen Wake Lock, which
   * needs no permission and is released by the browser the moment the tab is
   * hidden, so it is re-asked on every return. Best effort: a browser without
   * it, or one that refuses, is the behaviour we had.
   */
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const ask = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen") ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisible = () => {
      if (!document.hidden) void ask();
    };
    void ask();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // ONE wallet: the tables share the `lunar` scope with the crash game, and the
  // key has to name the SCOPE rather than the game — the wallet push only ever
  // says "lunar", so a per-game key would be a second cache entry nothing
  // updates.
  // The beacon takes the WHEEL's code, never a literal: this component renders
  // both tables, and a literal here would file every mini player onto the
  // classic wheel's live count. `presence:<game>` has no publisher, so a wrong
  // code cannot fail loudly — it just counts nobody, for ever.


  const balance = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        enabled: !!user,
        retry: false,
      },
    },
  );
  /**
   * The wallet balance, raw.
   *
   * The uncollected win is subtracted HERE and nowhere else — `Score = balance
   * − meter − staged`, computed in `useRouletteGame`. Holding it is a property
   * of this screen, not of the platform: the lobby and every other game show
   * the wallet balance as it stands, exactly as they did before these tables
   * existed.
   *
   * It has to be a local subtraction rather than a number the server pre-nets,
   * because the meter DRAINS during a TAKE a hundred milliseconds at a time and
   * watching the Score rise against it is the whole animation.
   */
  const balancePaise = balance.data?.balance != null ? BigInt(balance.data.balance) : null;

  const g = useRouletteGame(wheel, balancePaise);

  /**
   * Coming back to the tab: re-read the round, the wallet, the meter and the
   * history strip — nothing was drawn while there were no frames to draw in.
   *
   * The cabinet also gives the table up after 20 s away and ends the session
   * after 3 min without an accepted bet (parity spec 13 §3.1). Both were
   * built and then REMOVED (operator decision, 2026-09-14): a web player tabs
   * away and comes back as a matter of course, and a partner's player being
   * signed out of their own site's iframe for idling is not a rule this
   * platform wants. Only the catch-up half survives.
   */
  const catchUpRef = useRef(g.catchUp);
  catchUpRef.current = g.catchUp;
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) catchUpRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // A browser will not decode audio before a gesture, and the first spin is not
  // the moment to find that out.
  const warmed = useRef(false);
  //
  // Three gesture kinds, capture phase — WebKit counts `touchend` and
  // `keydown` as activation where `pointerdown` alone may not, and the resume
  // has to run synchronously inside the gesture. Whichever lands first warms.
  useEffect(() => {
    const events = ["pointerdown", "touchend", "keydown"] as const;
    const warm = () => {
      if (warmed.current) return;
      warmed.current = true;
      warmUpRouletteSounds();
      for (const e of events) document.removeEventListener(e, warm, true);
    };
    for (const e of events) document.addEventListener(e, warm, true);
    return () => {
      for (const e of events) document.removeEventListener(e, warm, true);
    };
  }, []);

  // ── the panel animation ──────────────────────────────────────────────────
  // Two views of one value. Chips and the chart read the CURVED one; the
  // buttons read the raw one. They are genuinely different motions on the
  // cabinet and a single curve makes the buttons lag the tray.
  const [panelT, setPanelT] = useState(0);
  const panelRaf = useRef<number | undefined>(undefined);
  useEffect(() => {
    const from = panelT;
    const to = g.panelOpen ? 1 : 0;
    if (from === to) return;
    const started = performance.now();
    /**
     * The duration scales with the distance LEFT to travel.
     *
     * One controller drives this on the cabinet, and `reverse()` there runs the
     * remaining span at the same speed — folding from half open takes 165 ms,
     * not 330. Running the full 330 from wherever it stood made an interrupted
     * open drift closed at half speed, which is the one case a player sees:
     * the window shutting while the tray is still on its way up.
     */
    const dur = PANEL_MS * Math.abs(to - from);
    const step = () => {
      const p = dur <= 0 ? 1 : Math.min(1, (performance.now() - started) / dur);
      setPanelT(from + (to - from) * p);
      if (p < 1) panelRaf.current = requestAnimationFrame(step);
    };
    panelRaf.current = requestAnimationFrame(step);
    return () => {
      if (panelRaf.current) cancelAnimationFrame(panelRaf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.panelOpen]);

  // Expand is eased, collapse is linear. Measured off the cabinet, and the
  // asymmetry is visible: an eased collapse reads as sticky.
  const layoutT = g.panelOpen ? easeInOut(panelT) : panelT;

  const tableRect = at(TABLE_SLOT, layoutT);

  // ── the title loop ───────────────────────────────────────────────────────
  const [titleFrame, setTitleFrame] = useState(0);
  useEffect(() => {
    if (TITLE_FRAMES.length === 0) return;
    const t = setInterval(
      () => setTitleFrame((f) => (f + 1) % TITLE_FRAMES.length),
      1000 / 5,
    );
    return () => clearInterval(t);
  }, []);

  // ── derived HUD values ───────────────────────────────────────────────────
  /**
   * OFFLINE means the board has stopped updating — not "we have no round".
   *
   * It read `snapshot !== null`, which made a cold stream look like a dropped
   * socket: a partner's table parks and retires when nobody is at it and
   * `/round` honestly answers null while it wakes, so every partner launch
   * opened on "Reconnecting". Worse, that line sits at priority 2 in the
   * cabinet's status order and the correct one — "Waiting for the next round ."
   * at priority 13 — was therefore UNREACHABLE, dead code for a state that
   * happens daily.
   *
   * With offline meaning "stopped", a stream with no round falls through to
   * its own line, and a genuinely stalled board still says so.
   */
  const online = !g.stale;
  const minPaise = minStakePaiseOf(g.config);
  const minPoints = Number(minPaise / PAISE_PER_POINT);
  const status = statusLine({
    notice: g.notice,
    online,
    spinning: g.spinning,
    awaitingReveal: g.flashPocket === null && g.spinning,
    frozen: g.frozenAtZero,
    removing: g.removing,
    acceptsBets: g.acceptsBets,
    reachedMinimum: g.reachedMinimum,
    minPoints,
    riding: g.betPlaced,
    judged: g.judged,
    autoSent: g.autoSent,
    celebrating: g.celebrating,
    offerPrevBet: g.offerPrevBet,
    lost: g.lost,
    phase: g.round.phase,
  });

  const canConfirm =
    g.acceptsBets &&
    online &&
    g.staged.length > 0 &&
    // The TOTAL against the table minimum, and nothing per spot.
    g.stagedPaise >= minPaise;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        style={{
          // The whole canvas STRETCHES to the window on both axes independently.
          // There is no letterbox: the cabinet fills its screen.
          position: "absolute",
          left: 0,
          top: 0,
          width: CANVAS_W,
          height: CANVAS_H,
          transformOrigin: "0 0",
        }}
        ref={useCanvasScale()}
      >
        <img
          src={IMG.backdrop}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {TITLE_FRAMES.length > 0 && (
          <img
            src={TITLE_FRAMES[titleFrame]}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: TITLE_ZONE.x,
              top: TITLE_ZONE.y,
              width: TITLE_ZONE.w,
              height: TITLE_ZONE.h,
            }}
          />
        )}

        {/* The opaque green under the chart. The art is transparent between cells. */}
        {layoutT > 0 && (
          <div
            style={{
              position: "absolute",
              left: tableRect.x,
              top: tableRect.y,
              width: tableRect.w,
              height: tableRect.h,
              background: PANEL_BACKING,
              opacity: layoutT,
            }}
          />
        )}

        <BetChart
          wheel={wheel}
          rect={tableRect}
          stakes={g.stakesShown}
          flashPocket={g.flashPocket}
          flashOn={g.flashOn}
          accepting={g.accepting}
          onOpenPanel={g.openPanel}
          onBet={g.stakeBet}
          removing={g.removing}
          onRemove={g.removeStake}
        />

        {/* The selection halo sits UNDER the coins, so only the ring shows. */}
        <img
          src={IMG.coinSelected}
          alt=""
          draggable={false}
          style={{ position: "absolute", ...px(chipRingRect(at(CHIP_SLOTS[g.chip], layoutT))) }}
        />
        {CHIPS.map((c) => (
          <img
            key={c}
            src={COIN[c]}
            alt=""
            draggable={false}
            onPointerDown={() => g.selectChip(c)}
            style={{
              position: "absolute",
              ...px(at(CHIP_SLOTS[c], layoutT)),
              cursor: "pointer",
            }}
          />
        ))}

        <WheelZoomBar
          rect={at(HUD_SLOTS.wheelZoom, panelT)}
          on={g.zoomOn}
          online={online}
          onToggle={g.toggleZoom}
        />

        {/*
          TAKE has no open-state home: it CROSS-FADES instead of travelling,
          because the panel's open layout has nowhere to put it. Its resting art
          is baked into the backdrop; only the lit frame is ours to draw.
        */}
        <TakeButton
          fade={takeFade(panelT, g.panelOpen)}
          lit={g.taking ? false : g.holdingWin && g.flashOn}
          enabled={g.holdingWin && panelT === 0}
          onPress={g.take}
        />

        <HudButton
          rect={at(HUD_SLOTS.betOk, panelT)}
          sprites={IMG.betOk}
          size={SPRITE_SIZE.betOk}
          fill={{ w: 249 / 258, h: 63 / 55 }}
          artDy={-7}
          label={g.offerPrevBet ? "Prev Bet" : "Bet Ok"}
          labelStyle={BUTTON_LABELS.betOk}
          // Bet Ok BLINKS while a layout is confirmable, and so does Prev Bet
          // while it is offered. A solid light would read as "already pressed".
          lit={(canConfirm || g.offerPrevBet) && g.flashOn}
          enabled={canConfirm || g.offerPrevBet}
          onPress={() => (g.offerPrevBet ? g.prevBet() : void g.confirmBets())}
        />
        <HudButton
          rect={at(HUD_SLOTS.cancelBet, panelT)}
          sprites={IMG.cancel}
          size={SPRITE_SIZE.cancel}
          fill={{ w: 0.95, h: 0.7 }}
          label="Cancel Bet"
          labelStyle={BUTTON_LABELS.cancelBet}
          lit={g.staged.length > 0}
          enabled={g.staged.length > 0}
          onPress={g.clearStaged}
        />
        <HudButton
          rect={at(HUD_SLOTS.cancelSpecific, panelT)}
          sprites={IMG.cancel}
          size={SPRITE_SIZE.cancel}
          fill={{ w: 0.95, h: 0.7 }}
          label="Cancel Specific Bet"
          labelStyle={BUTTON_LABELS.cancelSpecific}
          lit={g.removing}
          // Answers while ARMED even on an empty table, so a lit mode can
          // always be turned off; with nothing staged and not armed, dead.
          enabled={g.staged.length > 0 || g.removing}
          onPress={g.toggleRemoving}
        />

        <Meter zone={TEXT_ZONES.score} text={points(g.scorePaise)} />
        <Meter zone={TEXT_ZONES.win} text={String(pointsNum(g.meterShown ? g.meterPaise : 0n))} />
        <Meter zone={TEXT_ZONES.totalBet} text={String(pointsNum(g.totalBetPaise))} />
        <Meter zone={TEXT_ZONES.status} text={status} />
        <HistoryStrip wheel={wheel} pockets={g.history} />
        {/* Exit leaves OUR lobby. Inside a partner's frame there is no lobby
            to go to, so the control is theirs to provide, not ours to fake.
            It is the ONE control alive while the wheel runs — a player must
            always be able to leave (spec 08 §6b.6). */}
        {!embedded && <ExitLabel onPress={() => navigate("/")} />}

        {/*
          The wheel is HIDDEN the instant the panel starts to open — an instant
          toggle, not a fade. It stays mounted so a spin in flight is not
          restarted when the panel folds again.
        */}
        <div style={{ display: panelT !== 0 ? "none" : undefined }}>
          <SpinStage
            wheel={wheel}
            pocket={g.round.outcome?.pocket ?? null}
            roundId={g.round.roundId}
            startInMs={g.displayLeftMs}
            bettingWindowMs={g.bettingWindowMs}
            restingPocket={g.restingPocket}
            zoomEnabled={g.zoomOn}
            paused={g.holdingWin}
            onSpinning={g.setSpinning}
            onResultShown={g.onResultShown}
            onResultSkipped={g.onResultSkipped}
            onSpinStopped={() => undefined}
          />
        </div>

        {/*
          The clock sits ABOVE the zoom scrim: it is the one thing that must
          stay readable while the wheel is up.
        */}
        {g.lastSeconds && g.barFlashOn && (
          <img
            src={IMG.timerBarFlash}
            alt=""
            draggable={false}
            style={{ position: "absolute", ...px(TIMER_FLASH) }}
          />
        )}
        <Meter zone={TEXT_ZONES.timer} text={clockText(g.displayLeftMs)} />

        <FullscreenButton />
        <SoundButton />

        {/*
          One absorber over everything while the wheel runs — Exit EXCEPTED,
          which sits above it. The spin overlaps the next round's open window
          by about nine seconds, and this is the only thing stopping a player
          betting into a round whose number is already on screen. Wheel Zoom
          is drawn above it too, for paint order, but its own handler is dead
          while spinning (spec 08 §6b.6, reversed from the second edition).
        */}
        {g.spinning && (
          <div style={{ position: "absolute", inset: 0, zIndex: 50 }} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const px = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** Keeps the canvas stretched to the window, on both axes independently. */
function useCanvasScale() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const apply = () => {
      const el = ref.current;
      if (!el) return;
      // Stretched to the window — and TURNED a quarter turn when the window
      // is portrait, so a phone held upright still shows the landscape
      // cabinet. See `viewport.ts`.
      applyViewport(el);
    };
    apply();
    globalThis.addEventListener("resize", apply);
    globalThis.addEventListener("orientationchange", apply);
    return () => {
      globalThis.removeEventListener("resize", apply);
      globalThis.removeEventListener("orientationchange", apply);
    };
  }, []);
  return ref;
}

/**
 * TAKE's opacity through the panel animation.
 *
 * Opening it fades over the last 60% and closing it over the middle 50%, which
 * is measured rather than symmetric: it comes back before the panel has
 * finished folding, so the button is there when the tray clears it.
 */
function takeFade(t: number, opening: boolean): number {
  if (opening) return t <= 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
  if (t >= 0.7) return 0;
  if (t <= 0.2) return 1;
  return 1 - (t - 0.2) / 0.5;
}

function points(paise: bigint | null): string {
  // An unknown balance draws a dash. A zero would be a claim.
  return paise === null ? "—" : String(paise / PAISE_PER_POINT);
}

function pointsNum(paise: bigint): number {
  return Number(paise / PAISE_PER_POINT);
}

/**
 * `0 : <seconds>` — a spaced colon and the whole seconds left.
 *
 * TRUNCATED, not rounded up. The cabinet renders `remaining.inSeconds`, which
 * is Dart integer division, so it shows N for the whole span [N, N+1) seconds
 * and holds `0 : 0` through the entire final second before the wheel throws.
 * Rounding up put this build a full second ahead of the cabinet at every
 * instant and reduced `0 : 0` to the zero crossing itself. The tick sound
 * derives its second the same way and the two must move together, or the
 * audible tick and the digit disagree.
 */
function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  // `0 : <seconds>` — unpadded, and the seconds NEVER carry into minutes:
  // `0 : 60` → `0 : 9` → `0 : 0`, never `1 : 00`, never `0 : 09` (parity spec
  // 13 §2, third edition). The minute place is drawn because the cabinet draws
  // it and is always a zero: the window is admin-set per wheel, and a window
  // past a minute reads `0 : 70` rather than hiding the count of seconds a
  // player is reading.
  return `0 : ${s}`;
}

/**
 * A text meter — Flutter's FittedBox, in DOM.
 *
 * The glyphs carry a global (1.24, 0.89) stretch, the cabinet's own aspect. A
 * `size: null` meter FILLS its box: the text is measured and scaled so it spans
 * the box exactly, THEN stretched — which means it ends up 24% WIDER than its
 * box. That is not a bug to clip away: the cabinet's clock and score both run
 * past their bars, and the first version of this component cut the digits off
 * at the box edge with `overflow: hidden`, which read as a broken font.
 *
 * A sized meter renders at its size, scales DOWN uniformly only if it would
 * overflow, and sits centred — a short prompt and a long refusal share one
 * voice and one home.
 *
 * Measured with `offsetWidth`, which ignores CSS transforms, so the canvas's
 * own stretch does not fold into the number.
 */
function Meter({ zone, text }: { zone: TextZone; text: string }) {
  const boxFill = zone.size === null;
  const fontSize = boxFill ? zone.rect.h : zone.size! * TEXT_STRETCH.y;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const fontsTick = useFontsReady();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setNatural({ w: el.offsetWidth, h: el.offsetHeight });
  }, [text, fontSize, zone.family, fontsTick]);

  let sx: number;
  let sy: number;
  if (boxFill) {
    const fill = natural.w > 0 ? zone.rect.w / natural.w : 1;
    sx = fill * TEXT_STRETCH.x * zone.stretchX;
    sy = TEXT_STRETCH.y;
  } else {
    /**
     * The fit is measured on the STRETCHED width, not the natural one.
     *
     * The cabinet's `Transform.scale` sits INSIDE the FittedBox, so what gets
     * shrunk to fit is the already-widened text. Measuring first and stretching
     * afterwards meant the fit test never saw the 1.39x it was about to apply,
     * so a label could pass the test and then overflow its box by that factor
     * and spill out both sides. The exposed one is the status line, which is
     * Comic 36 with its own 1.10 in a 1200px box and carries sentences.
     */
    const wanted = glyphScaleX(zone.stretchX);
    const down =
      natural.w > 0 && natural.h > 0
        ? Math.min(1, zone.rect.w / (natural.w * wanted), zone.rect.h / natural.h)
        : 1;
    sx = down * wanted;
    sy = down;
  }
  return (
    <div
      style={{
        position: "absolute",
        ...px(zone.rect),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span
        ref={ref}
        style={{
          fontFamily: fontStack(zone.family),
          fontWeight: zone.weight,
          fontSize,
          lineHeight: 1,
          color: zone.color,
          whiteSpace: "nowrap",
          transform: `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
          transformOrigin: "50% 50%",
          // Invisible until measured, so the first frame is not the unfitted
          // text jumping into place.
          visibility: natural.w > 0 ? "visible" : "hidden",
        }}
      >
        {text}
      </span>
    </div>
  );
}

/** Bumps once the cabinet's faces have loaded, so meters re-measure in them. */
function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, []);
  return tick;
}

/**
 * The last five results: five fixed slots, newest on the RIGHT, filling from
 * the right when there are fewer than five.
 */
function HistoryStrip({ wheel, pockets }: { wheel: Wheel; pockets: number[] }) {
  const zone = TEXT_ZONES.history;
  const slotW = zone.rect.w / 5;
  const shown = pockets.slice(-5);
  const pad = 5 - shown.length;
  return (
    <div style={{ position: "absolute", ...px(zone.rect), display: "flex", pointerEvents: "none" }}>
      {Array.from({ length: 5 }, (_, i) => {
        const p = i < pad ? null : shown[i - pad]!;
        const colour =
          p === null
            ? "transparent"
            : pocketColor(wheel, p) === "green"
              ? COLORS.historyGreen
              : pocketColor(wheel, p) === "red"
                ? COLORS.historyRed
                : COLORS.historyBlack;
        return (
          <div
            key={i}
            style={{
              width: slotW,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fontStack(zone.family),
              fontWeight: 700,
              fontSize: zone.size! * TEXT_STRETCH.y,
              lineHeight: 1,
              color: colour,
              // The strip is a SIZED meter and carries the same glyph stretch
              // as every other one. It had none, so each result was drawn at
              // 72% of the cabinet's width — the one text on the screen a
              // player compares against the wheel.
              transform: `scaleX(${glyphScaleX(zone.stretchX).toFixed(4)})`,
            }}
          >
            {p === null ? "" : pocketLabel(wheel, p)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fullscreen toggle, top right — on BOTH surfaces.
 *
 * A local player's page can go fullscreen itself. A partner's player sits in
 * an iframe, and an iframe may only do that when every frame above it granted
 * `allow="fullscreen"` — which is the partner's markup, not ours. The first
 * version hid the button when the API was unavailable, and inside a partner
 * page that read as "the partner build has no fullscreen". Now the button is
 * always there: if this document cannot do it, it asks the host page through
 * the launcher bridge (`lunar:fullscreen`), and the host fullscreens the
 * iframe ELEMENT, which needs no permission at all. The SDK and the /launch
 * wrapper both answer that message; the host reports back with
 * `lunar:fullscreenChanged` so the icon follows.
 *
 * Going fullscreen also asks the browser to hold landscape where allowed; the
 * portrait case is covered by turning the canvas in CSS regardless.
 */
function FullscreenButton() {
  const [on, setOn] = useState<boolean>(() => !!document.fullscreenElement);
  const framed = typeof window !== "undefined" && window.parent !== window;
  const canSelf =
    typeof document !== "undefined" &&
    (document.fullscreenEnabled || !!(document as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    // The host's answer when it did the work for us.
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; on?: unknown } | null;
      if (d && d.type === "lunar:fullscreenChanged" && typeof d.on === "boolean") setOn(d.on);
    };
    window.addEventListener("message", onMsg);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("message", onMsg);
    };
  }, []);
  const toggle = async () => {
    if (!canSelf) {
      // Not ours to grant. The host page can always fullscreen the frame it
      // owns, so the request goes up; "*" because the wrapper at /launch is
      // same-origin and the partner is whoever embedded it.
      if (framed) {
        try {
          window.parent.postMessage(
            { source: "lunar", type: "lunar:fullscreen", on: !on, ts: Date.now() },
            "*",
          );
        } catch {
          // A host that closed the window. Nothing to do.
        }
      }
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      const o = screen.orientation as { lock?: (t: string) => Promise<void> } | undefined;
      await o?.lock?.("landscape").catch(() => undefined);
    } catch {
      // A browser that will not go fullscreen from this gesture. Nothing to do.
    }
  };
  // Hidden only where NOBODY can do it: a top-level page with no fullscreen API
  // at all (an old iPhone Safari). Framed, the host can, so it stays.
  if (!canSelf && !framed) return null;
  const S = 64;
  return (
    <div
      onPointerDown={() => void toggle()}
      title={on ? "Exit fullscreen" : "Fullscreen"}
      data-testid="button-fullscreen"
      style={{ position: "absolute", left: CANVAS_W - S - 18, top: 14, width: S, height: S, cursor: "pointer", zIndex: 40 }}
    >
      <svg viewBox="0 0 64 64" width={S} height={S} aria-hidden="true">
        <defs>
          <radialGradient id="fsBadge" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#1f5a1f" />
            <stop offset="100%" stopColor="#062406" />
          </radialGradient>
          <linearGradient id="fsRim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbe58a" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#8a6a12" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="29" fill="url(#fsBadge)" stroke="url(#fsRim)" strokeWidth="4" />
        <circle cx="32" cy="32" r="23.5" fill="none" stroke="#d4af37" strokeOpacity="0.45" strokeWidth="1" />
        <g fill="none" stroke="#fbe58a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          {on ? (
            <>
              <path d="M27 18v9h-9" /><path d="M37 18v9h9" /><path d="M27 46v-9h-9" /><path d="M37 46v-9h9" />
            </>
          ) : (
            <>
              <path d="M18 27v-9h9" /><path d="M46 27v-9h-9" /><path d="M18 37v9h9" /><path d="M46 37v9h-9" />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

/**
 * The Sound toggle, beside Fullscreen, on BOTH surfaces.
 *
 * The cabinet has no mute and the spec says not to add one; this build
 * applies the platform Sound setting instead (recorded deviation). Locally
 * that setting lives in the lobby's menu — but a partner's player never sees
 * our lobby, so on the partner surface the wheels played every cue with no
 * way to turn them off, while Aviator, which draws its own header, had its
 * toggle. This is the SAME setting Aviator's menu toggles (`settings.sound`),
 * so a player who mutes one game has muted all of them, on either surface.
 * Drawn in the same badge as Fullscreen, one slot to its left.
 */
function SoundButton() {
  const sound = useStore((st) => st.settings.sound);
  const S = 64;
  return (
    <div
      onPointerDown={() => updateSettings({ sound: !sound })}
      title={sound ? "Sound off" : "Sound on"}
      data-testid="button-sound"
      style={{ position: "absolute", left: CANVAS_W - S * 2 - 18 - 14, top: 14, width: S, height: S, cursor: "pointer", zIndex: 40 }}
    >
      <svg viewBox="0 0 64 64" width={S} height={S} aria-hidden="true">
        {/* Its own gradients: the fullscreen badge is not mounted everywhere. */}
        <defs>
          <radialGradient id="sndBadge" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#1f5a1f" />
            <stop offset="100%" stopColor="#062406" />
          </radialGradient>
          <linearGradient id="sndRim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbe58a" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#8a6a12" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="29" fill="url(#sndBadge)" stroke="url(#sndRim)" strokeWidth="4" />
        <circle cx="32" cy="32" r="23.5" fill="none" stroke="#d4af37" strokeOpacity="0.45" strokeWidth="1" />
        <g fill="none" stroke="#fbe58a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 27h6l8-7v24l-8-7h-6z" fill="#fbe58a" />
          {sound ? (
            <>
              <path d="M39 26a8 8 0 0 1 0 12" />
              <path d="M43 21a14 14 0 0 1 0 22" />
            </>
          ) : (
            <>
              <path d="M39 26l8 12" /><path d="M47 26l-8 12" />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

function ExitLabel({ onPress }: { onPress: () => void }) {
  const zone = TEXT_ZONES.exit;
  return (
    <div
      onPointerDown={onPress}
      style={{
        position: "absolute",
        ...px(zone.rect),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        // Above the spin absorber: Exit is never blocked.
        zIndex: 60,
        fontFamily: fontStack(zone.family),
        fontWeight: zone.weight,
        fontSize: zone.size! * TEXT_STRETCH.y,
        color: zone.color,
        // Sized like every other label, and it was missing the stretch too —
        // "Exit" drew at 65% of its width. Its own 1.10 was declared in the
        // zone and read by nobody.
        transform: `scaleX(${glyphScaleX(zone.stretchX).toFixed(4)})`,
      }}
    >
      Exit
    </div>
  );
}

/**
 * A HUD button.
 *
 * The lit frame is drawn OVER the resting art, never swapped for it, and scaled
 * by the ratio of the two native sprite sizes so the lit bar lands exactly on
 * the resting bar and only the glow spills outside.
 *
 * Buttons NEVER dim when disabled — the cabinet's did not, and only the tap is
 * guarded. A greyed-out button here would be a change of design, not a
 * clarification.
 */
function HudButton({
  rect,
  sprites,
  size,
  fill,
  artDy = 0,
  label,
  labelStyle,
  lit,
  enabled,
  onPress,
}: {
  rect: Rect;
  sprites: readonly [string, string];
  size: { rest: { w: number; h: number }; lit: { w: number; h: number } };
  fill: { w: number; h: number };
  artDy?: number;
  label: string;
  labelStyle: { size: number; stretchX: number; dx: number; dy: number; family: string };
  lit: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  const restW = rect.w * fill.w;
  const restH = rect.h * fill.h;
  const litW = restW * (size.lit.w / size.rest.w);
  const litH = restH * (size.lit.h / size.rest.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2 + artDy;
  return (
    <div
      onPointerDown={() => enabled && onPress()}
      style={{
        position: "absolute",
        ...px(rect),
        cursor: enabled ? "pointer" : "default",
      }}
    >
      <img
        src={sprites[0]}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: cx - rect.x - restW / 2,
          top: cy - rect.y - restH / 2,
          width: restW,
          height: restH,
          // See the lit frame below: the app's reset caps every image at its
          // parent's width, and the rest sprite fills that width exactly, so
          // it is only one rounding away from the same clamp.
          maxWidth: "none",
        }}
      />
      {lit && (
        <img
          src={sprites[1]}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: cx - rect.x - litW / 2,
            top: cy - rect.y - litH / 2,
            width: litW,
            height: litH,
            /**
             * The lit frame is WIDER than the button it sits in — that is the
             * whole point of it, the glow spilling past the resting art — and
             * the app's CSS reset puts `max-width: 100%` on every `<img>`,
             * resolved against this positioned parent. Without the opt-out the
             * frame was silently clamped to the button's own width (Bet Ok 252
             * instead of 260.9) while its explicit height stayed full, so the
             * glow stopped registering on the bar underneath it, on every beat
             * of the 334 ms blink. The ring sprite carries the same opt-out for
             * the same reason.
             */
            maxWidth: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: rect.w / 2 + labelStyle.dx,
          top: rect.h / 2 + labelStyle.dy,
          transform: `translate(-50%, -50%) scaleX(${
            glyphScaleX(labelStyle.stretchX)
          })`,
          fontFamily: fontStack(labelStyle.family),
          fontWeight: 700,
          fontSize: labelStyle.size * TEXT_STRETCH.y,
          lineHeight: 1,
          color: "#FFFFFF",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function TakeButton({
  fade,
  lit,
  enabled,
  onPress,
}: {
  fade: number;
  lit: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  const l = BUTTON_LABELS.take;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fade, pointerEvents: "none" }}>
      {lit && (
        <img
          src={IMG.take[1]}
          alt=""
          draggable={false}
          style={{ position: "absolute", ...px(TAKE_LIT) }}
        />
      )}
      <div
        onPointerDown={() => enabled && onPress()}
        style={{
          position: "absolute",
          ...px(TAKE_TOUCH),
          pointerEvents: enabled ? "auto" : "none",
          cursor: enabled ? "pointer" : "default",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: TAKE_TOUCH.w / 2 + l.dx,
            top: TAKE_TOUCH.h / 2 + l.dy,
            transform: `translate(-50%, -50%) scaleX(${
              glyphScaleX(l.stretchX)
            })`,
            fontFamily: fontStack(l.family),
            fontWeight: 700,
            fontSize: l.size * TEXT_STRETCH.y,
            lineHeight: 1,
            color: "#FFFFFF",
            whiteSpace: "nowrap",
          }}
        >
          Take
        </div>
      </div>
    </div>
  );
}

function WheelZoomBar({
  rect,
  on,
  online,
  onToggle,
}: {
  rect: Rect;
  on: boolean;
  online: boolean;
  onToggle: () => void;
}) {
  const l = BUTTON_LABELS.wheelZoom;
  return (
    <div
      onPointerDown={onToggle}
      style={{
        position: "absolute",
        ...px(rect),
        cursor: "pointer",
        /**
         * ABOVE the spin absorber — for PAINT ORDER, not for input. The
         * zoomed wheel's box stops short of this corner, so nothing draws
         * over the button; but its handler is dead while the wheel runs
         * (`toggleZoom` returns on `spinning`). The second edition had it as
         * the one live control mid-spin; the third reversed that — in the
         * hand it read as the wheel lurching in and out under a spin nobody
         * can stop.
         */
        zIndex: 60,
      }}
    >
      <img
        src={IMG.wheelZoomBar}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div
        style={{
          position: "absolute",
          left: rect.w / 2 + l.dx,
          top: rect.h / 2 + l.dy,
          transform: `translate(-50%, -50%) scaleX(${
            glyphScaleX(l.stretchX)
          })`,
          fontFamily: fontStack(l.family),
          fontWeight: 700,
          fontSize: l.size * TEXT_STRETCH.y,
          lineHeight: 1,
          // Offline is said HERE and on the status line, and nowhere else.
          // There is no overlay: a modal over a live table is a worse lie than
          // a paused one.
          color: online ? "#FFFFFF" : COLORS.offline,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {online ? `Wheel Zoom: ${on ? "ON" : "OFF"}` : "RECONNECTING"}
      </div>
    </div>
  );
}

/**
 * The status line's priority order, top down, first match wins.
 *
 * This IS the game's voice — the screen opens no dialogs and shows no banners,
 * so every refusal, prompt and result lands here. The order is what makes it
 * readable: a passing notice outranks a standing prompt, and being offline
 * outranks everything but that.
 */
export function statusLine(s: {
  notice: string | null;
  online: boolean;
  spinning: boolean;
  awaitingReveal: boolean;
  frozen: boolean;
  removing: boolean;
  acceptsBets: boolean;
  /** The staged total has reached the minimum at least once this round (latched). */
  reachedMinimum: boolean;
  minPoints: number;
  /** A live bet of ours on the round the list still describes. */
  riding: boolean;
  /** The wheel has already spoken about THAT round. */
  judged: boolean;
  /** The deadline, not the player, sent this round's layout. */
  autoSent: boolean;
  celebrating: boolean;
  offerPrevBet: boolean;
  lost: boolean;
  phase: string | null;
}): string {
  if (s.notice) return s.notice;
  if (!s.online) return "Reconnecting . Betting is paused";
  if (s.spinning && s.awaitingReveal) return "FOR AMUSEMENT ONLY NO CASH VALUE.";
  if (s.frozen) return "Please Take the Winning Points.";
  if (s.removing) return "Tap a chip to take it back";
  /**
   * Row 6 — the staged line is a CHOICE, and it latches (08 §7.1). Both
   * moves are open once the total reaches the minimum: keep building the
   * layout, or confirm. Below it the line says NOTHING about the minimum —
   * Bet Ok not sending is what says it, and the idle prompt already carries
   * the figure for a player who has not started.
   */
  const CHOICE = "You can either make Bet or Press BETOK Button.";
  if (s.acceptsBets && s.reachedMinimum) return CHOICE;
  /**
   * `onIt` — the acceptance, and where it stops (08 §7.2/§7.3). Ranked TWICE:
   * above an EARLIER round's verdict, and below the verdict of the round it
   * was on. Once the window SHUTS, who placed the layout decides: the
   * player's own press hands the line to `Bet Time Over.` (they were told
   * the bet was on at the press); a layout the deadline sent keeps saying so,
   * because nobody pressed anything.
   */
  const shut = !s.acceptsBets;
  const onIt = s.riding && (!shut || s.autoSent);
  if (onIt && !s.judged) return "Your Bet Has Been Accepted.";
  // 8 / 8b: after TAKE the blink has moved from Take to Prev Bet and the
  // line moves with it — the offer means the table is ready and one press
  // repeats the layout, which is the two moves the choice line names. The
  // LOSS keeps its own line: it already names both moves AND says what
  // happened.
  if (s.celebrating) return s.offerPrevBet ? CHOICE : "Congratulations!!! You Win.";
  if (s.lost) return "Game over. Press PreBetOK Button or Make Bet.";
  if (onIt) return "Your Bet Has Been Accepted.";
  if (s.phase === "betting" && !s.acceptsBets) return "Bet Time Over.";
  if (s.phase === null) return "Waiting for the next round .";
  if (s.acceptsBets) return `Please Bet to Start Game . Minimum Bet=${s.minPoints}`;
  return "Bet Time Over.";
}
