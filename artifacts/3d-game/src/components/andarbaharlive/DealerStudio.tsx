import { useEffect, useRef, useState } from "react";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import { orderedCards, type Deal } from "./model";
import {
  cardQuad,
  dealerCue,
  restingQuad,
  shownCards,
  TRACKS,
  IDLE_TRACK,
  PREPARED_FPS,
  type Quad,
} from "./dealerTimeline";
import { createStudioRenderer, type StudioCard } from "./studioRenderer";

const media = `${import.meta.env.BASE_URL}media/andar-bahar-live/`;
const takes = ["idle", "joker", "andar", "bahar"] as const;
const PREROLL = 0.4;
type Take = (typeof takes)[number];
const startOf = (take: Take) =>
  take === "idle" ? IDLE_TRACK.start : TRACKS[take].start;
export type Presentation = { roundId: string; joker: boolean; dealt: number };
export function DealerStudio({
  deal,
  snapshot,
  clock,
  motion,
  fresh,
  onPresentation,
}: {
  deal: Deal | null;
  snapshot: TableRoundSnapshot | null;
  clock: number;
  motion: boolean;
  fresh: boolean;
  onPresentation: (value: Presentation) => void;
}) {
  const videos = useRef<Partial<Record<Take, HTMLVideoElement>>>({});
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({
    deal,
    snapshot,
    clock,
    motion,
    fresh,
    onPresentation,
    observedAt: performance.now(),
  });
  latest.current = {
    deal,
    snapshot,
    clock,
    motion,
    fresh,
    onPresentation,
    observedAt:
      latest.current.clock === clock
        ? latest.current.observedAt
        : performance.now(),
  };
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const players = videos.current as Record<Take, HTMLVideoElement>;
    const c = canvas.current!;
    let renderer: ReturnType<typeof createStudioRenderer>;
    try {
      renderer = createStudioRenderer(c);
    } catch {
      setFailed(true);
      return;
    }
    let active: Take = "idle";
    let warming: Take | null = null;
    let animation = 0,
      key = "",
      lastPresentation = "",
      lastFrame = -1,
      lastKind = "",
      lastRateUpdate = -Infinity,
      lastPaintAt = 0;
    let seeks = 0,
      paints = 0,
      plateReady = false,
      stopped = false;
    const callbacks = new Map<HTMLVideoElement, number>();
    const pending = new Set<HTMLVideoElement>();
    const costs: number[] = [];
    const startedAt = performance.now();
    let clockAt = 0,
      clockValue = 0,
      clockRound = "";
    let cachedDeal: Deal | null = null,
      sequence: ReturnType<typeof orderedCards> = [];
    const plate = new Image();
    plate.onload = () => {
      renderer.setPlate(plate);
      plateReady = true;
      paint(performance.now(), players[active].currentTime, active);
    };
    plate.onerror = () => setFailed(true);
    plate.src = `${media}felt-plate-v3.png`;
    function cueAt(time: number) {
      const s = latest.current;
      const target = s.clock + time - s.observedAt;
      const round = s.snapshot?.roundId ?? "";
      const elapsed = Math.max(0, time - clockAt);
      const predicted = clockValue + elapsed;
      if (round !== clockRound || Math.abs(target - predicted) > 1500) {
        clockValue = target;
        clockRound = round;
      } else {
        // Poll latency must not move a hand backwards or replay a card at a
        // slot boundary. Ease small clock corrections into forward playback.
        clockValue =
          predicted +
          Math.max(
            -elapsed * 0.04,
            Math.min(elapsed * 0.04, target - predicted),
          );
      }
      clockAt = Math.max(clockAt, time);
      return dealerCue(s.snapshot, s.deal, clockValue);
    }
    function takeFor(cue: ReturnType<typeof dealerCue>): Take {
      return cue.kind === "idle" || cue.kind === "hold" ? "idle" : cue.side;
    }
    function prepare(take: Take) {
      const v = players[take];
      v.pause();
      // Warming a paused decoder never interrupts the take currently on screen.
      if (
        v.readyState >= 1 &&
        !v.seeking &&
        Math.abs(v.currentTime - (startOf(take) - PREROLL)) > 0.025
      )
        v.currentTime = startOf(take) - PREROLL;
    }
    function play(v: HTMLVideoElement, warm = false) {
      if (!v.paused || pending.has(v)) return;
      pending.add(v);
      void v
        .play()
        .then(() => {
          if (!warm || stopped || warming === null || players[warming] !== v)
            return;
          // Chrome may take 200–250 ms to start a paused decoder. Absorb that
          // startup off screen and align it while it is already playing.
          const s = latest.current;
          const future = dealerCue(
            s.snapshot,
            s.deal,
            clockValue + performance.now() - clockAt + PREROLL * 1000,
          );
          if (takeFor(future) === warming && !v.seeking)
            v.currentTime = Math.max(0, future.time - future.rate * PREROLL);
        })
        .catch((error: unknown) => {
          if (
            !stopped &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            setFailed(true);
        })
        .finally(() => pending.delete(v));
    }
    function preRollNext() {
      const s = latest.current;
      if (!s.motion) {
        if (warming) prepare(warming);
        warming = null;
        return;
      }
      const future = dealerCue(s.snapshot, s.deal, clockValue + PREROLL * 1000);
      const next = takeFor(future);
      if (next === active) return;
      if (warming && warming !== next) prepare(warming);
      warming = next;
      const v = players[next];
      if (v.readyState < 2 || v.seeking) return;
      const target = Math.max(0, future.time - future.rate * PREROLL);
      if (Math.abs(v.currentTime - target) > 0.1 && !pending.has(v))
        v.currentTime = target;
      if (v.playbackRate !== future.rate) v.playbackRate = future.rate;
      play(v, true);
    }
    function paint(time: number, decodedTime: number, take: Take) {
      const start = performance.now(),
        state = latest.current,
        v = players[take];
      if (
        take !== active ||
        !plateReady ||
        !state.fresh ||
        v.seeking ||
        v.readyState < 2
      )
        return;
      const cue = cueAt(time);
      if (takeFor(cue) !== take) return;
      const opening = cue.kind === "joker" || cue.kind === "card";
      if (
        opening &&
        (decodedTime < TRACKS[cue.side].start - 0.04 || decodedTime >= cue.end)
      )
        return;
      const shown = shownCards(cue, decodedTime, state.deal);
      const cards: StudioCard[] = [];
      if (state.deal && cue.kind !== "idle") {
        const joker =
          cue.kind === "joker"
            ? cardQuad("joker", decodedTime)
            : restingQuad("joker");
        if (joker) cards.push({ card: state.deal.joker, quad: joker });
        if (cachedDeal !== state.deal) {
          cachedDeal = state.deal;
          sequence = orderedCards(state.deal);
        }
        const completed =
          cue.kind === "hold" ? sequence.length : Math.max(0, cue.index);
        for (const side of ["andar", "bahar"] as const) {
          const pile = sequence
            .slice(0, completed)
            .filter((entry) => entry.side === side);
          if (!pile.length) continue;
          const q = restingQuad(side),
            depth = Math.min(2.5, pile.length * 0.18);
          cards.push({
            card: pile.at(-1)!.card,
            quad: q.map((n, i) => n + (i % 2 ? depth : -depth)) as Quad,
          });
          cards.push({
            card: pile.at(-1)!.card,
            quad: q,
            winner: cue.kind === "hold" && state.deal.winner === side,
          });
        }
        if (cue.kind === "card") {
          const q = cardQuad(cue.side, decodedTime);
          if (q)
            cards.push({
              card: sequence[cue.index].card,
              quad: q,
              winner: shown.dealt === sequence.length,
            });
        }
      }
      if (!renderer.render(v, cards, decodedTime)) return;
      lastFrame = decodedTime;
      c.dataset.cue = cue.key;
      c.dataset.frame = decodedTime.toFixed(6);
      c.dataset.dealt = String(shown.dealt);
      c.dataset.joker = String(shown.joker);
      c.dataset.renderer = "gpu";
      c.dataset.sourceFps = "30";
      c.dataset.preparedFps = String(PREPARED_FPS);
      c.dataset.motionVersion = "7";
      c.dataset.playbackRate = v.playbackRate.toFixed(3);
      if (lastPaintAt) c.dataset.frameGap = (time - lastPaintAt).toFixed(1);
      lastPaintAt = time;
      c.dataset.paints = String(++paints);
      c.dataset.seeks = String(seeks);
      const presentationKey = `${state.snapshot?.roundId}:${shown.joker}:${shown.dealt}`;
      if (lastPresentation !== presentationKey) {
        lastPresentation = presentationKey;
        state.onPresentation({
          roundId: state.snapshot?.roundId ?? "",
          ...shown,
        });
      }
      costs.push(performance.now() - start);
      if (costs.length > 120) costs.shift();
      if (paints % 30 === 0)
        c.dataset.paintP95 = costs
          .slice()
          .sort((a, b) => a - b)
          [Math.floor((costs.length - 1) * 0.95)].toFixed(2);
    }
    const listeners = takes.map((take) => {
      const v = players[take];
      v.dataset.active = String(take === active);
      const loaded = () => prepare(take);
      const seeked = () => paint(performance.now(), v.currentTime, take);
      v.addEventListener("loadedmetadata", loaded);
      v.addEventListener("seeked", seeked);
      if (v.readyState >= 1) prepare(take);
      if (v.requestVideoFrameCallback) {
        const decoded = (now: number, metadata: VideoFrameCallbackMetadata) => {
          if (stopped) return;
          paint(now, metadata.mediaTime, take);
          callbacks.set(v, v.requestVideoFrameCallback(decoded));
        };
        callbacks.set(v, v.requestVideoFrameCallback(decoded));
      }
      return () => {
        v.removeEventListener("loadedmetadata", loaded);
        v.removeEventListener("seeked", seeked);
      };
    });
    function control(time: number) {
      animation = requestAnimationFrame(control);
      const state = latest.current;
      if (document.hidden || !state.fresh) {
        players[active].pause();
        if (warming) prepare(warming);
        warming = null;
        return;
      }
      const cue = cueAt(time),
        take = takeFor(cue);
      const nextKey = `${state.snapshot?.roundId}:${cue.key}:${state.motion}`;
      const changed = key !== nextKey;
      if (
        changed &&
        key &&
        state.motion &&
        (cue.kind === "idle" || cue.kind === "hold" || lastKind === "idle")
      )
        renderer.beginWaitingTransition();
      if (take !== active) {
        const previous = active;
        players[previous].dataset.active = "false";
        active = take;
        if (warming === take) warming = null;
        lastFrame = -1;
        players[active].dataset.active = "true";
        prepare(previous);
      }
      const v = players[active];
      if (!plateReady || v.readyState < 2 || v.seeking) {
        if (time - startedAt > 15000 && v.error) setFailed(true);
        return;
      }
      const opening = cue.kind === "joker" || cue.kind === "card";
      const target = state.motion
        ? cue.time
        : opening
          ? cue.time >= TRACKS[cue.side].release
            ? TRACKS[cue.side].release + 0.02
            : TRACKS[cue.side].start
          : 1;
      const drift = target - v.currentTime;
      if (
        (changed && Math.abs(drift) > 0.16) ||
        Math.abs(drift) > 0.8 ||
        (!state.motion && Math.abs(drift) > 0.04)
      ) {
        key = nextKey;
        lastKind = cue.kind;
        v.currentTime = target;
        seeks++;
        return;
      }
      key = nextKey;
      lastKind = cue.kind;
      const atEnd = opening && v.currentTime >= cue.end - 1 / PREPARED_FPS;
      if (!state.motion || atEnd) v.pause();
      else {
        if (changed || time - lastRateUpdate >= 250) {
          const correction =
            Math.abs(drift) > 0.08
              ? Math.max(0.96, Math.min(1.04, 1 + drift * 0.1))
              : 1;
          const rate = cue.rate * correction;
          if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
          lastRateUpdate = time;
        }
        play(v);
      }
      if (
        changed ||
        (!v.requestVideoFrameCallback &&
          Math.abs(v.currentTime - lastFrame) > 0.001)
      )
        paint(time, v.currentTime, active);
      preRollNext();
    }
    const contextLost = (event: Event) => {
      event.preventDefault();
      takes.forEach((take) => players[take].pause());
      setFailed(true);
    };
    const contextRestored = () => {
      setFailed(false);
      setGeneration((n) => n + 1);
    };
    c.addEventListener("webglcontextlost", contextLost);
    c.addEventListener("webglcontextrestored", contextRestored);
    const resize = () => {
      // object-fit: contain can leave letterboxing inside the canvas element.
      const displayWidth = Math.min(
        c.clientWidth,
        (c.clientHeight * 1430) / 565,
      );
      if (renderer.resize(displayWidth * window.devicePixelRatio))
        paint(performance.now(), players[active].currentTime, active);
    };
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(c);
    window.addEventListener("resize", resize);
    resize();
    animation = requestAnimationFrame(control);
    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      for (const [v, callback] of callbacks)
        v.cancelVideoFrameCallback(callback);
      takes.forEach((take) => players[take].pause());
      listeners.forEach((remove) => remove());
      c.removeEventListener("webglcontextlost", contextLost);
      c.removeEventListener("webglcontextrestored", contextRestored);
      sizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      plate.onload = plate.onerror = null;
      plate.src = "";
      renderer.dispose();
    };
  }, [generation]);
  return (
    <div className="ab-studio" data-testid="ab-studio">
      {takes.map((take) => (
        <video
          key={take}
          ref={(element) => {
            if (element) videos.current[take] = element;
          }}
          data-take={take}
          src={`${media}dealer-continuous-v7.mp4`}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      ))}
      <canvas
        ref={canvas}
        width={1430}
        height={565}
        role="img"
        aria-label="Andar Bahar dealer opening cards by hand at the gold studio table"
      />
      {failed && (
        <span className="ab-video-note">
          Studio video unavailable · Table remains connected
        </span>
      )}
    </div>
  );
}
