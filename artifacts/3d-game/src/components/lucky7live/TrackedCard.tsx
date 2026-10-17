import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { L7Card } from "@workspace/api-zod/lucky7-live";
import { CardInk } from "./CardInk";
import { DEALER } from "./dealerTimeline";

import {
  quadAt,
  project,
  resting,
  cardMaskFrame,
  CARD_MASK,
  type Quad,
} from "./dealerCardTrack";

const maskUrl = `${import.meta.env.BASE_URL}media/lucky7-live/dealer-hand-masks-v5.png`;

export function TrackedCard({
  card,
  time,
  fallback,
  video,
}: {
  card: L7Card | null;
  time: number;
  fallback: boolean;
  video: RefObject<HTMLVideoElement | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const currentCard = useRef(card);
  currentCard.current = card;
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    const resize = () => setScale(parent.clientWidth / 1920);
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = host.current,
      v = video.current;
    if (!element) return;
    let callback = 0,
      animation = 0;
    const paint = (mediaTime: number) => {
      // Keep the projection mounted before the first face-up frame. Mounting
      // from a React state update left the ink one decoded frame behind the
      // dealer's fingers during the fastest part of the turn.
      const visible =
        !!currentCard.current &&
        (fallback ||
          (mediaTime >= DEALER.faceAt && mediaTime < DEALER.clearEnd));
      element.style.visibility = visible ? "visible" : "hidden";
      element.dataset.testid = visible ? "l7-dealt-card" : "l7-card-paper";
      const quad = (fallback ? resting : quadAt(mediaTime)).map(([x, y]) => [
        x,
        y - 30,
      ]) as Quad;
      const p = project(quad);
      element.style.transform = `matrix3d(${(p.a * scale) / 100},${(p.d * scale) / 100},0,${p.g / 100},${(p.b * scale) / 140},${(p.e * scale) / 140},0,${p.h / 140},0,0,1,0,${p.c * scale},${p.f * scale},0,1)`;
      const mask = fallback ? -1 : cardMaskFrame(mediaTime);
      element.style.maskImage = mask < 0 ? "none" : `url("${maskUrl}")`;
      element.style.maskPosition = `${-(mask % CARD_MASK.columns) * CARD_MASK.width}px ${-Math.floor(mask / CARD_MASK.columns) * CARD_MASK.height}px`;
      element.dataset.mediaTime = String(mediaTime);
    };
    // Paint in the decoded-frame callback itself. A React render one frame
    // later would leave the ink floating above the card during its fast turn.
    // currentTime is a seek request, not necessarily the frame on screen.
    // A decoded-frame callback is authoritative even before seeked fires.
    if (!v?.seeking)
      paint(Number(element.dataset.mediaTime ?? v?.currentTime ?? time));
    if (v && !fallback) {
      if (v.requestVideoFrameCallback) {
        const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          paint(metadata.mediaTime);
          callback = v.requestVideoFrameCallback(frame);
        };
        callback = v.requestVideoFrameCallback(frame);
      } else {
        const frame = () => {
          paint(v.currentTime);
          animation = requestAnimationFrame(frame);
        };
        animation = requestAnimationFrame(frame);
      }
    }
    return () => {
      if (callback) v?.cancelVideoFrameCallback(callback);
      cancelAnimationFrame(animation);
    };
  }, [video, fallback, scale, time, card]);
  return (
    <div
      ref={host}
      className={`l7-table-card${fallback ? " is-fallback" : ""}`}
      style={{
        opacity: scale ? 1 : 0,
        maskRepeat: "no-repeat",
        maskSize: `${CARD_MASK.width * CARD_MASK.columns}px ${CARD_MASK.height * CARD_MASK.rows}px`,
      }}
    >
      {card && <CardInk card={card} />}
    </div>
  );
}
