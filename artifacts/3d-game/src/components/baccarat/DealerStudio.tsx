import { useEffect, useRef, useState } from "react";
import { createStudioRenderer, type StudioCard } from "./studioRenderer";
import {
  IDLE,
  TAKES,
  movingQuad,
  orderedCards,
  presentedCount,
  restingQuad,
  studioCue,
  type StudioDeal,
  type StudioPhase,
} from "./studioTimeline";

const media = `${import.meta.env.BASE_URL}media/baccarat/`;
export type Presentation = { roundId: string | null; count: number };
export default function DealerStudio(props: {
  deal: StudioDeal | null;
  phase: StudioPhase;
  roundId: string | null;
  elapsedMs: number;
  revealMs: number;
  motion: boolean;
  onPresentation: (value: Presentation) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const latest = useRef({ ...props, observedAt: performance.now() });
  latest.current = {
    ...props,
    observedAt:
      latest.current.elapsedMs === props.elapsedMs &&
      latest.current.phase === props.phase
        ? latest.current.observedAt
        : performance.now(),
  };
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const c = canvas.current!,
      // React clears callback refs before passive cleanup. Retain the mounted
      // elements so leaving the table can still stop every player safely.
      players = [...videos.current] as HTMLVideoElement[];
    let renderer: ReturnType<typeof createStudioRenderer>;
    try {
      renderer = createStudioRenderer(c);
    } catch {
      setFailed(true);
      return;
    }
    let active = 0,
      frame = 0,
      key = "",
      lastPresentation = "",
      ready = false,
      stopped = false,
      paints = 0,
      lastStaticPaint = 0;
    const callbacks = new Map<HTMLVideoElement, number>();
    const pending = new Set<HTMLVideoElement>();
    const cueAt = (now: number) => {
      const s = latest.current;
      return studioCue(
        s.phase,
        s.elapsedMs + now - s.observedAt,
        s.revealMs,
        s.deal,
      );
    };
    const publish = (count: number) => {
      const id = `${latest.current.roundId}:${count}`;
      if (id !== lastPresentation) {
        lastPresentation = id;
        latest.current.onPresentation({
          roundId: latest.current.roundId,
          count,
        });
      }
    };
    function paint(now: number, decoded: number, index: number) {
      if (stopped || index !== active || !ready) return;
      const v = players[active],
        s = latest.current,
        cue = cueAt(now);
      if (v.seeking || v.readyState < 2 || (s.motion && cue.take + 1 !== active)) return;
      if (
        s.motion &&
        cue.take >= 0 &&
        (decoded < TAKES[cue.take].start - 0.04 || decoded >= cue.end)
      )
        return;
      const count = presentedCount(cue, s.motion ? decoded : cue.time),
        sequence = orderedCards(s.deal),
        cards: StudioCard[] = [];
      if (s.phase === "reveal" || s.phase === "settling") {
        for (const entry of sequence.slice(0, s.motion ? cue.completed : count))
          cards.push({
            card: entry.card,
            quad: restingQuad(entry.side, entry.index),
            winner: cue.key === "hold" && s.deal?.winner === entry.side,
          });
        if (s.motion && cue.take >= 0) {
          const entry = sequence[cue.index],
            quad = movingQuad(cue.take, decoded, entry.index);
          if (quad) cards.push({ card: entry.card, quad });
        }
      }
      if (renderer.render(v, cards)) {
        c.dataset.cue = cue.key;
        c.dataset.dealt = String(count);
        c.dataset.frame = decoded.toFixed(3);
        c.dataset.paints = String(++paints);
        publish(count);
      }
    }
    const plate = new Image();
    plate.onload = () => {
      renderer.setPlate(plate);
      ready = true;
      paint(performance.now(), players[active].currentTime, active);
    };
    plate.onerror = () => setFailed(true);
    plate.src = `${media}clean-table.png`;
    const listeners = players.map((v, index) => {
      const prepare = () => {
        if (index !== active) {
          v.pause();
          v.currentTime = index ? TAKES[index - 1].start : IDLE.start;
        }
      };
      const seeked = () => paint(performance.now(), v.currentTime, index);
      v.addEventListener("loadedmetadata", prepare);
      v.addEventListener("seeked", seeked);
      if (v.readyState >= 1) prepare();
      if (v.requestVideoFrameCallback) {
        const decoded = (now: number, info: VideoFrameCallbackMetadata) => {
          if (stopped) return;
          paint(now, info.mediaTime, index);
          callbacks.set(v, v.requestVideoFrameCallback(decoded));
        };
        callbacks.set(v, v.requestVideoFrameCallback(decoded));
      }
      return () => {
        v.removeEventListener("loadedmetadata", prepare);
        v.removeEventListener("seeked", seeked);
      };
    });
    function control(now: number) {
      frame = requestAnimationFrame(control);
      const s = latest.current;
      if (document.hidden) {
        players[active].pause();
        return;
      }
      const cue = cueAt(now),
        index = s.motion ? cue.take + 1 : 0,
        nextKey = `${s.roundId}:${s.phase}:${cue.key}:${s.motion}`;
      if (index !== active) {
        players[active].pause();
        active = index;
      }
      const v = players[active];
      if (v.readyState < 2 || v.seeking) return;
      if (!s.motion) {
        v.pause();
        if (Math.abs(v.currentTime - IDLE.start) > .04) v.currentTime = IDLE.start;
        if (now - lastStaticPaint >= 100) {
          paint(now, v.currentTime, index); lastStaticPaint = now;
        }
        return;
      }
      const changed = nextKey !== key;
      if (changed || Math.abs(v.currentTime - cue.time) > 0.24) {
        v.currentTime = Math.min(cue.end - 1 / 30, cue.time);
        key = nextKey;
      }
      v.playbackRate = Math.min(4, cue.rate);
      if (v.paused && !pending.has(v)) {
        pending.add(v);
        void v
          .play()
          .catch(() => {})
          .finally(() => pending.delete(v));
      }
      if (!v.requestVideoFrameCallback) paint(now, v.currentTime, index);
    }
    const resize = () =>
      renderer.resize(
        c.getBoundingClientRect().width * Math.min(2, devicePixelRatio),
      );
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    resize();
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    const restored = () => {
      setFailed(false);
      setGeneration((v) => v + 1);
    };
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", restored);
    frame = requestAnimationFrame(control);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const [v, cb] of callbacks) v.cancelVideoFrameCallback(cb);
      players.forEach((v) => v.pause());
      listeners.forEach((remove) => remove());
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", restored);
      plate.onload = plate.onerror = null;
      renderer.dispose();
    };
  }, [generation]);

  // Network/graphics failures still reveal authoritative cards in the accessible
  // score panel; uncomposited footage is never shown as a fallback.
  useEffect(() => {
    if (!failed) return;
    const cue = studioCue(
      props.phase,
      props.elapsedMs,
      props.revealMs,
      props.deal,
    );
    props.onPresentation({
      roundId: props.roundId,
      count: presentedCount(cue, cue.time),
    });
  }, [
    failed,
    props.phase,
    props.elapsedMs,
    props.revealMs,
    props.deal,
    props.roundId,
    props.onPresentation,
  ]);
  return (
    <div className="bc-studio" data-testid="baccarat-studio">
      {[0, 1, 2, 3, 4].map((index) => (
        <video
          key={index}
          ref={(element) => {
            videos.current[index] = element;
          }}
          src={`${media}dealer-studio.mp4`}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      ))}
      <canvas
        ref={canvas}
        width={1200}
        height={480}
        role="img"
        aria-label="Baccarat dealer dealing at the black and gold studio table"
      />
      {failed && (
        <span className="bc-media-note" role="status">
          Dealer video unavailable. Cards and game remain connected.
        </span>
      )}
    </div>
  );
}
