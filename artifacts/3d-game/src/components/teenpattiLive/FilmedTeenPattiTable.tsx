import { useId, useLayoutEffect, useRef, useState } from "react";
import { cardRankLabel, cardSuitSymbol } from "@/components/baccarat/cards";
import { formatChip } from "@/components/table/chips";
import { cn } from "@/lib/utils";
import type { TeenPattiTableViewProps } from "./FlatTeenPattiTable";
import { TEEN_PATTI_SPOTS, categoryLabel } from "./types";
import dealerFilm from "@/assets/teenpatti/riya-hd-studio.mp4";
import { mobileGameMedia, preferLightMedia } from "@/lib/mediaProfile";
import dealerPoster from "@/assets/teenpatti/riya-hd-opening.jpg";
import resultPoster from "@/assets/teenpatti/riya-hd-result.jpg";
import bettingPoster from "@/assets/teenpatti/riya-hd-betting.jpg";
import { CARD_CUES, DEALER_FILM, FILM_WORLD } from "./dealerFilm";
import { createDealerPlayback } from "./dealerPlayback";
import {
  filmCameraFrame,
  preparationAt,
  SHUFFLE_MS,
  type TableCamera,
} from "./tableCameras";
import { CardBack } from "./TableCardArt";
import ShuffleShoe, { type ShuffleController } from "./ShuffleShoe";
import OverheadTable from "./OverheadTable";
import PhysicalCardFace from "./PhysicalCardFace";
import CustomerCardView from "./CustomerCardView";
import "./teen-patti-studio.css";

/** One persistent player for the seated expressions and complete opening.
 * Card values always use the authoritative server result. */
export default function FilmedTeenPattiTable(props: TeenPattiTableViewProps) {
  const {
    deal,
    roundKey,
    revealEndsAt,
    revealDurationMs = 9000,
    bettingEndsAt = null,
    chips,
    animate,
    spotLabels,
    waitingLabel,
    className,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bridge = useRef<HTMLCanvasElement>(null);
  const ink = useRef<(SVGGElement | null)[]>([]);
  const dealtCards = useRef<(SVGGElement | null)[]>([]);
  const overheadCards = useRef<(SVGGElement | null)[]>([]);
  const customerCards = useRef<(SVGSVGElement | null)[]>([]);
  const shuffler = useRef<ShuffleController>(null);
  const shoeId = `tpl-shoe-${useId().replace(/:/g, "")}`;
  const preparation = useRef<{
    key: string;
    landed: boolean[];
    shuffled: boolean;
  } | null>(null);
  const cameraLabel = useRef<HTMLSpanElement>(null);
  const [camera, setCamera] = useState<TableCamera>("auto");
  const [filmSource] = useState(() => preferLightMedia() ? mobileGameMedia("teenPatti") : dealerFilm);
  const cameraChoice = useRef(camera);
  cameraChoice.current = camera;
  const [failed, setFailed] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const visibleResult = !!deal && landed === roundKey;
  const anchor = useRef<{
    key: string;
    start: number;
    duration: number;
    done: boolean;
    cue: number;
  } | null>(null);
  const motion = useRef<"idle" | "reveal" | "rest">("idle");

  useLayoutEffect(() => {
    if (!deal || !roundKey) {
      anchor.current = null;
      setLanded(null);
    } else if (anchor.current?.key !== roundKey) {
      const now = Date.now();
      const phaseStart =
        revealEndsAt != null ? revealEndsAt - revealDurationMs : now;
      // Reserve the natural performance at 1x speed inside the server window.
      // Short/late reveals skip ahead; the whole dealer remains in view.
      const leadIn = Math.min(
        450,
        Math.max(0, revealDurationMs - DEALER_FILM.actionDuration * 1000 - 150),
      );
      const start = phaseStart + leadIn;
      const duration =
        animate && revealEndsAt != null && revealEndsAt - now > 500
          ? Math.min(
              DEALER_FILM.actionDuration * 1000,
              Math.max(0, revealDurationMs - leadIn - 150),
            )
          : 0;
      const initialMedia = duration
        ? DEALER_FILM.actionEnd -
          Math.max(0, duration - Math.max(0, now - start)) / 1000
        : DEALER_FILM.actionEnd;
      anchor.current = {
        key: roundKey,
        start,
        duration,
        done: false,
        // A join/reconnect never plays old card sounds in a burst.
        cue:
          CARD_CUES.findIndex((cue) => cue.at >= initialMedia) < 0
            ? CARD_CUES.length
            : CARD_CUES.findIndex((cue) => cue.at >= initialMedia),
      };
      if (duration) latest.current.audio?.onDealStart?.();
    }
    if (!animate && anchor.current) anchor.current.duration = 0;
  }, [deal, roundKey, revealEndsAt, revealDurationMs, animate]);

  useLayoutEffect(() => {
    const player = video.current;
    if (!player) return;
    let frame = 0;
    let disposed = false;
    let last = Date.now();
    let lastPaint = 0;
    const frameInterval = 1000 / (filmSource === dealerFilm ? 60 : 30);
    let fitMeasuredAt = 0;
    let fitWasPreparing = false;
    let fittedMaxHeight: number | undefined;
    const loadingTimeout = !ready && !failed && animate
      ? window.setTimeout(() => setFailed(true), 8000)
      : undefined;
    const playback = createDealerPlayback(player, bridge.current, () =>
      setFailed(true),
    );
    const size = {
      width: root.current?.clientWidth ?? FILM_WORLD.width,
      height: root.current?.clientHeight ?? FILM_WORLD.height,
    };
    let cameraKey = "";
    const landscapeLayout = window.matchMedia(
      "(min-width: 560px) and (max-width: 1023px) and (orientation: landscape)",
    );
    let previousCamera = "";
    let drawnFrame: {
      x: number;
      y: number;
      scale: number;
      top: number;
      bottom: number;
    } | null = null;
    let cameraMove: {
      from: {
        x: number;
        y: number;
        scale: number;
        top: number;
        bottom: number;
      };
      start: number;
    } | null = null;
    const resize = new ResizeObserver(([entry]) => {
      size.width = entry.contentRect.width;
      size.height = entry.contentRect.height;
      fitMeasuredAt = 0;
    });
    if (root.current) resize.observe(root.current);
    const paint = () => {
      if (disposed) return;
      const timestamp = performance.now();
      if (!document.hidden && timestamp - lastPaint < frameInterval) {
        frame = requestAnimationFrame(paint);
        return;
      }
      lastPaint = timestamp - ((timestamp - lastPaint) % frameInterval);
      const now = Date.now();
      const stale = document.hidden || now - last > 250;
      last = now;
      const current = anchor.current;
      const t = current?.duration
        ? Math.max(0, Math.min(1, (now - current.start) / current.duration))
        : 1;
      const available = ready && !failed && animate && !document.hidden;
      const preparing = latest.current.bettingEndsAt != null;
      const table = root.current?.parentElement;
      // Read layout before changing SVG/style attributes. Re-reading the dock
      // after every animated card used to force layout on every display tick.
      if (now - fitMeasuredAt >= 200 || preparing !== fitWasPreparing) {
        fitMeasuredAt = now;
        fitWasPreparing = preparing;
        const dock = table?.parentElement?.querySelector<HTMLElement>('[data-testid="tpl-betting-dock"]');
        fittedMaxHeight = preparing && !landscapeLayout.matches && window.innerWidth < 1024 && table && dock
          ? Math.max(140, window.innerHeight - (table.getBoundingClientRect().top + window.scrollY) - dock.offsetHeight - 16)
          : undefined;
      }
      root.current?.setAttribute(
        "data-idle-active",
        String(preparing && available),
      );
      const mode = !current
        ? "idle"
        : t >= 1
          ? "rest"
          : now < current.start
            ? "hold"
            : "reveal";
      const targetMedia = current
        ? DEALER_FILM.actionEnd - ((1 - t) * current.duration) / 1000
        : 0;
      playback.update({
        mode,
        key: current?.key ?? "idle",
        mediaTime: targetMedia,
        enabled:
          available && (mode !== "idle" || cameraChoice.current !== "cards"),
        resync: stale,
      });
      motion.current = !current ? "idle" : t >= 1 ? "rest" : "reveal";
      const openingFrame =
        playback.state.mode === "reveal" && playback.state.frameReady;
      root.current?.setAttribute(
        "data-media-time",
        playback.state.mediaTime.toFixed(4),
      );
      root.current?.setAttribute("data-frame-ready", String(openingFrame));
      const selectedCamera =
        cameraChoice.current === "auto"
          ? preparing || !current
            ? "dealer"
            : "hands"
          : cameraChoice.current;
      root.current?.setAttribute("data-camera", selectedCamera);
      const sideBySide = selectedCamera === "hands" && landscapeLayout.matches;
      const layout = sideBySide ? "side" : "stack";
      if (root.current && root.current.dataset.layout !== layout)
        root.current.dataset.layout = layout;
      if (selectedCamera !== previousCamera && root.current) {
        // The mobile close-up reserves enough height for readable cards.
        size.width = root.current.clientWidth;
        size.height = root.current.clientHeight;
      }
      const maxHeight = fittedMaxHeight;
      let framing = filmCameraFrame(
        size.width,
        size.height,
        selectedCamera === "hands",
        sideBySide,
        maxHeight,
      );
      const minimumHeight = framing.minHeight ? `${framing.minHeight}px` : "";
      if (table && table.style.minHeight !== minimumHeight) {
        table.style.minHeight = minimumHeight;
        size.height = root.current!.clientHeight;
        framing = filmCameraFrame(
          size.width,
          size.height,
          selectedCamera === "hands",
          sideBySide,
          maxHeight,
        );
      }
      root.current?.style.setProperty(
        "--tpl-customer-height",
        `${framing.customerHeight}px`,
      );
      root.current?.style.setProperty(
        "--tpl-customer-card-width",
        `${framing.customerCardWidth}px`,
      );
      root.current?.style.setProperty(
        "--tpl-film-right",
        `${size.width - framing.filmWidth}px`,
      );
      // Interpolate in the root's coordinates, then subtract the viewport
      // inset. Changing the crop must not move the cards down by 44px during
      // the first zoom frames, especially on a narrow phone.
      const targetFrame = {
        x: framing.x,
        y: framing.y + framing.top,
        scale: framing.scale,
        top: framing.top,
        bottom: framing.bottom,
      };
      const nextCameraKey = `${selectedCamera}:${sideBySide}:${size.width}:${size.height}`;
      if (cameraKey !== nextCameraKey) {
        cameraMove =
          animate &&
          drawnFrame &&
          previousCamera !== "cards" &&
          selectedCamera !== "cards" &&
          (previousCamera !== selectedCamera ||
            cameraKey.split(":").slice(1).join(":") ===
              nextCameraKey.split(":").slice(1).join(":"))
            ? { from: drawnFrame, start: now }
            : null;
        cameraKey = nextCameraKey;
        previousCamera = selectedCamera;
      }
      const mix = cameraMove ? Math.min(1, (now - cameraMove.start) / 450) : 1;
      const eased = 1 - Math.pow(1 - mix, 3);
      drawnFrame = cameraMove
        ? {
            x: cameraMove.from.x + (targetFrame.x - cameraMove.from.x) * eased,
            y: cameraMove.from.y + (targetFrame.y - cameraMove.from.y) * eased,
            scale:
              cameraMove.from.scale +
              (targetFrame.scale - cameraMove.from.scale) * eased,
            top:
              cameraMove.from.top +
              (targetFrame.top - cameraMove.from.top) * eased,
            bottom:
              cameraMove.from.bottom +
              (targetFrame.bottom - cameraMove.from.bottom) * eased,
          }
        : targetFrame;
      if (mix >= 1) cameraMove = null;
      root.current?.style.setProperty("--tpl-film-top", `${drawnFrame.top}px`);
      root.current?.style.setProperty(
        "--tpl-film-bottom",
        `${drawnFrame.bottom}px`,
      );
      root.current?.setAttribute(
        "data-customer-ready",
        String(selectedCamera === "hands" && mix >= 1),
      );
      if (stage.current)
        stage.current.style.transform = `translate(${drawnFrame.x}px, ${drawnFrame.y - drawnFrame.top}px) scale(${drawnFrame.scale})`;
      root.current?.setAttribute("data-preparing", String(preparing));
      if (cameraLabel.current)
        cameraLabel.current.textContent =
          selectedCamera === "hands"
            ? current && t >= 1
              ? "TABLE RESULT"
              : "DEALER & CARDS"
            : selectedCamera === "cards"
              ? "CARD CAMERA · OVERHEAD"
              : "DEALER CAMERA";
      if (preparing) {
        const p = preparationAt(
          now,
          latest.current.bettingEndsAt!,
          latest.current.bettingDurationMs ?? 20000,
          animate,
        );
        if (preparation.current?.key !== latest.current.roundKey) {
          preparation.current = {
            key: latest.current.roundKey,
            landed: p.cards.map((c) => c.landed),
            shuffled: p.elapsed > 1400,
          };
        }
        const prep = preparation.current;
        if (!prep.shuffled && p.phase === "shuffle" && p.elapsed >= 300) {
          prep.shuffled = true;
          if (!stale && animate) latest.current.audio?.onShuffle?.();
        }
        root.current?.setAttribute("data-stage", p.phase);
        root.current?.setAttribute(
          "data-dealt-count",
          String(p.cards.filter((c) => c.landed).length),
        );
        shuffler.current?.update(p.elapsed, animate);
        p.cards.forEach((card, index) => {
          const element = dealtCards.current[index];
          element?.setAttribute("transform", card.matrix);
          element?.setAttribute(
            "visibility",
            card.visible ? "visible" : "hidden",
          );
          element?.setAttribute("data-dealt", String(card.landed));
          overheadCards.current[index]?.setAttribute(
            "data-dealt",
            String(card.visible),
          );
          overheadCards.current[index]?.setAttribute("data-face-up", "false");
          customerCards.current[index]?.setAttribute("data-face-up", "false");
          customerCards.current[index]?.setAttribute(
            "aria-label",
            "Face-down card",
          );
          if (card.landed && !prep.landed[index]) {
            prep.landed[index] = true;
            if (!stale && animate && card.raw < 1.3)
              latest.current.audio?.onCardDeal?.(index);
          }
        });
      } else {
        root.current?.setAttribute(
          "data-stage",
          current ? (t >= 1 ? "result" : "opening") : "ready",
        );
        // Keep the six dealt backs on the waiting plate during the camera
        // move and initial seek; retire them when the filmed paper arrives.
        const waitingForHands = current && t < 1 && !openingFrame;
        const heldCards = waitingForHands
          ? preparationAt(now, now, 20000, false).cards
          : null;
        dealtCards.current.forEach((card, index) => {
          card?.setAttribute(
            "visibility",
            waitingForHands ? "visible" : "hidden",
          );
          if (heldCards)
            card?.setAttribute("transform", heldCards[index].matrix);
        });
        shuffler.current?.update(SHUFFLE_MS, false);
      }
      if (current && latest.current.deal) {
        // Follow decoded media while it plays. A failed/stalled video never
        // delays settlement beyond the server's reveal deadline.
        const mediaTime =
          t >= 1
            ? DEALER_FILM.actionEnd
            : openingFrame
              ? playback.state.mediaTime
              : -1;
        for (let index = 0; index < 6; index++) {
          const element = ink.current[index];
          if (!element) continue;
          const up =
            current.duration === 0 ||
            t >= 1 ||
            mediaTime >= DEALER_FILM.printAfter[index];
          // Print only after the matching edited hand has placed this card.
          // The customer and overhead views follow exactly the same cue.
          const printable = up && (t >= 1 || openingFrame);
          element.setAttribute("aria-hidden", String(!printable));
          ink.current[index]?.setAttribute(
            "visibility",
            printable ? "visible" : "hidden",
          );
          ink.current[index]?.setAttribute("data-face-up", String(printable));
          overheadCards.current[index]?.setAttribute(
            "data-face-up",
            String(up),
          );
          overheadCards.current[index]?.setAttribute("data-dealt", "true");
          if (up) {
            // Once opened, the readable card stays up across decoder seeks.
            // Each new round mounts fresh backs, with the same A/B ordering.
            const value =
              index < 3
                ? latest.current.deal.handACards[index]
                : latest.current.deal.handBCards[index - 3];
            customerCards.current[index]?.setAttribute("data-face-up", "true");
            customerCards.current[index]?.setAttribute(
              "aria-label",
              `${cardRankLabel(value)} ${cardSuitSymbol(value)}`,
            );
          }
        }
        root.current?.setAttribute("data-deal-progress", t.toFixed(4));
        root.current?.setAttribute("data-action", t >= 1 ? "rest" : "opening");
        while (
          current.cue < CARD_CUES.length &&
          CARD_CUES[current.cue].at <= mediaTime
        ) {
          const cue = CARD_CUES[current.cue++];
          if (
            !stale &&
            current.duration &&
            t < 1 &&
            mediaTime - cue.at < 0.18
          ) {
            if (cue.kind === "lift")
              latest.current.audio?.onCardFlip?.(cue.index);
            else latest.current.audio?.onCardLand?.(cue.index);
          }
        }
        if (t >= 1 && !current.done) {
          current.done = true;
          setLanded(current.key);
          // Restore the sound bed even after a hidden-tab or late-join snap.
          // Individual audible card cues above still discard stale events.
          latest.current.audio?.onReveal?.();
          latest.current.onSettled?.(current.key);
        }
      } else {
        root.current?.setAttribute("data-action", "waiting");
        root.current?.removeAttribute("data-deal-progress");
      }
      root.current?.setAttribute(
        "data-film-state",
        !animate ? "reduced" : failed ? "fallback" : motion.current,
      );
      if (!document.hidden) frame = requestAnimationFrame(paint);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      paint();
    };
    document.addEventListener("visibilitychange", resume);
    paint();
    return () => {
      disposed = true;
      resize.disconnect();
      window.clearTimeout(loadingTimeout);
      cancelAnimationFrame(frame);
      playback.dispose();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ready, failed, animate, filmSource]);

  return (
    <div
      ref={root}
      className={cn("tpl-studio tpl-film-studio", className)}
      data-testid="tpl-flat-table"
      data-presentation="filmed-dealer"
      data-action="waiting"
      data-camera="dealer"
      data-stage="ready"
      data-preparing={bettingEndsAt != null}
    >
      <div className="tpl-film-viewport" data-testid="tpl-film-viewport">
        <div className="tpl-film-stage" ref={stage}>
          <img
            src={
              bettingEndsAt != null
                ? bettingPoster
                : visibleResult
                  ? resultPoster
                  : dealerPoster
            }
            alt="Riya in a burgundy satin waistcoat at the green Teen Patti table"
            className="tpl-film-poster"
          />
          <img
            src={resultPoster}
            className="tpl-result-poster"
            data-testid="tpl-result-poster"
            alt="Revealed cards on the same table"
          />
          <svg
            className="tpl-physical-ink"
            viewBox={`0 0 ${FILM_WORLD.width} ${FILM_WORLD.height}`}
            preserveAspectRatio="xMidYMid slice"
            role="group"
            aria-label="Cards on the table"
          >
            {Array.from({ length: 6 }, (_, index) => {
              const value =
                index < 3
                  ? deal?.handACards[index]
                  : deal?.handBCards[index - 3];
              return (
                <g
                  key={`${roundKey}-${index}`}
                  ref={(el) => {
                    ink.current[index] = el;
                  }}
                  visibility="hidden"
                  data-testid={`tpl-physical-card-${index}`}
                  data-face-up="false"
                  data-card={value}
                  role="img"
                  aria-hidden="true"
                  aria-label={
                    value != null
                      ? `${cardRankLabel(value)} ${cardSuitSymbol(value)}`
                      : "Face-down card"
                  }
                >
                  {value != null && (
                    <PhysicalCardFace
                      index={index}
                      value={value}
                      won={
                        visibleResult &&
                        deal?.winner === (index < 3 ? "playerA" : "playerB")
                      }
                    />
                  )}
                </g>
              );
            })}
          </svg>
          <svg
            className="tpl-felt-lettering"
            viewBox={`0 0 ${FILM_WORLD.width} ${FILM_WORLD.height}`}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            {(["playerA", "playerB"] as const).map((side, index) => (
              <g
                key={side}
                transform={`translate(${index ? 536 : 323} 459)`}
                textAnchor="middle"
              >
                <path
                  d="M-78 -8 L-86 -8 L-86 -17 M78 -8 L86 -8 L86 -17"
                  fill="none"
                  stroke={
                    visibleResult && deal?.winner === side
                      ? "#f5d277"
                      : "#d3c18a70"
                  }
                />
                <text
                  fill={
                    visibleResult && deal?.winner === side
                      ? "#ffe19b"
                      : "#ece4ca"
                  }
                  fontSize="13"
                  fontWeight="700"
                  letterSpacing="2"
                >
                  {spotLabels[side].toUpperCase()}
                </text>
                <text y="16" fill="#d4c9aa" fontSize="10" letterSpacing="1">
                  {visibleResult && deal
                    ? categoryLabel(
                        (index ? deal.handB : deal.handA).category,
                      ).toUpperCase()
                    : "3 CARDS"}
                </text>
              </g>
            ))}
          </svg>
          <video
            ref={video}
            src={filmSource}
            poster={dealerPoster}
            muted
            playsInline
            preload={animate ? "auto" : "none"}
            className={cn(
              "tpl-dealer-video",
              ready && !failed && animate && "tpl-dealer-video-ready",
            )}
            onLoadedData={() => { setReady(true); setFailed(false); }}
            onError={() => setFailed(true)}
            data-testid="tpl-dealer-film"
            aria-hidden="true"
          />
          {animate && (
            <canvas
              ref={bridge}
              className="tpl-film-bridge"
              data-testid="tpl-film-bridge"
              data-held="false"
              aria-hidden="true"
            />
          )}
          <svg
            className="tpl-shoe-scene"
            viewBox={`0 0 ${FILM_WORLD.width} ${FILM_WORLD.height}`}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <ShuffleShoe id={shoeId} ref={shuffler} />
            </defs>
            <g
              transform="translate(143 390) scale(.54)"
              data-testid="tpl-shuffle-shoe"
            >
              <use href={`#${shoeId}`} />
            </g>
            {Array.from({ length: 6 }, (_, index) => (
              <g
                key={index}
                ref={(el) => {
                  dealtCards.current[index] = el;
                }}
                visibility="hidden"
                data-testid={`tpl-dealt-card-${index}`}
              >
                <CardBack />
              </g>
            ))}
          </svg>
        </div>
      </div>
      <OverheadTable
        deal={deal}
        settled={visibleResult}
        cardRef={(index, element) => {
          overheadCards.current[index] = element;
        }}
      />
      <CustomerCardView
        deal={deal}
        roundKey={roundKey}
        settled={visibleResult}
        cardRef={(index, element) => {
          customerCards.current[index] = element;
        }}
      />
      <div
        className="tpl-shuffle-closeup"
        data-testid="tpl-shuffle-closeup"
        aria-label="Close-up of the automatic card shuffler"
      >
        <span>
          SHUFFLE CAMERA <i />
        </span>
        <svg viewBox="-16 -9 196 130" aria-hidden="true">
          <use href={`#${shoeId}`} />
        </svg>
      </div>
      <div className="tpl-camera-toolbar" aria-label="Table camera">
        <span ref={cameraLabel}>DEALER CAMERA</span>
        <div>
          {(["auto", "dealer", "cards"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              data-testid={`tpl-camera-${mode}`}
              aria-pressed={camera === mode}
              onClick={() => setCamera(mode)}
            >
              {mode === "auto"
                ? "Auto"
                : mode === "dealer"
                  ? "Dealer"
                  : "Cards"}
            </button>
          ))}
        </div>
      </div>
      <div className="tpl-studio-wordmark" aria-hidden="true">
        <span>LUNAR CASINO</span>
        <strong>TEEN PATTI</strong>
        <em>20 · 20</em>
      </div>
      <div className="tpl-studio-status">
        <span className="tpl-live-dot" /> TABLE{" "}
        <span className="tpl-studio-id">01</span>
      </div>
      <div className="tpl-dealer-name">
        <span /> RIYA <small>ANIMATED DEALER</small>
      </div>
      <div className="tpl-table-message" data-testid="tpl-waiting">
        {!deal ? (
          <>
            <span className="tpl-prep-shuffle">Shuffling in the side tray</span>
            <span className="tpl-prep-ready">{waitingLabel}</span>
            <span className="tpl-prep-dealing">Dealing from the side shoe</span>
            <span className="tpl-prep-dealt">
              Six cards ready · bets closing
            </span>
          </>
        ) : visibleResult ? (
          "Hands revealed"
        ) : (
          "Riya is opening the cards"
        )}
      </div>
      <div className="tpl-table-sequence" aria-label="Table sequence">
        <span data-step="shuffle">Shuffle</span>
        <i />
        <span data-step="dealing">Deal</span>
        <i />
        <span data-step="opening">Open</span>
        <i />
        <span data-step="result">Result</span>
      </div>
      <div className="tpl-felt-bets">
        {TEEN_PATTI_SPOTS.map((spot) => (
          <div
            key={spot}
            className={cn(
              "tpl-felt-bet",
              (chips[spot] ?? 0) > 0 && "tpl-felt-bet-active",
            )}
            data-testid={`tpl-flat-spot-${spot}`}
          >
            <span>{spotLabels[spot]}</span>
            {(chips[spot] ?? 0) > 0 && (
              <strong>{formatChip(chips[spot]!)}</strong>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
