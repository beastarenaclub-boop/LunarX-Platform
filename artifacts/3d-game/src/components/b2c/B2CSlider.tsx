import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

/** Native touch scrolling with a continuous, measured loop for the two lobby rows. */
export function B2CSlider<T>({
  items,
  renderItem,
  label,
  variant,
  paused = false,
}: {
  items: readonly T[];
  renderItem: (item: T, index: number, duplicate: boolean) => ReactNode;
  label: string;
  variant: "trending" | "winners";
  paused?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [stopped, setStopped] = useState(false);
  const state = useRef({
    hovered: false,
    focused: false,
    dragging: false,
    holdUntil: 0,
    paused: false,
  });
  useEffect(() => {
    state.current.paused = paused || stopped;
  }, [paused, stopped]);

  useEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!root || !viewport || !group) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cycle = 0;
    let looping = false;
    let visible = false;
    let frame = 0;
    let previousTime = 0;
    let remainder = 0;
    let previousWidth = -1;

    function measure() {
      const width = viewport!.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      const compact = window.innerWidth <= 500;
      const gap =
        variant === "trending"
          ? 4
          : compact
            ? 10
            : window.innerWidth <= 800
              ? 12
              : 20;
      const cardWidth =
        variant === "trending"
          ? Math.max(compact ? 175 : 190, (width - 6 * gap) / 7)
          : compact
            ? 190
            : 200;
      root!.style.setProperty("--b2c-slide-width", `${cardWidth}px`);
      root!.style.setProperty("--b2c-slide-gap", `${gap}px`);
      cycle = group!.getBoundingClientRect().width;
      looping = items.length > 1 && cycle >= width;
      root!.dataset.loop = String(looping);
      viewport!.scrollLeft = looping ? cycle : 0;
    }
    function normalize() {
      if (!looping || !cycle) return;
      const left = viewport!.scrollLeft;
      if (left >= cycle * 2) viewport!.scrollLeft = left - cycle;
      else if (left < cycle) viewport!.scrollLeft = left + cycle;
    }
    function tick(time: number) {
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 0;
      previousTime = time;
      const interaction = state.current;
      const running =
        looping &&
        visible &&
        !document.hidden &&
        !reduced.matches &&
        !interaction.paused &&
        !interaction.hovered &&
        !interaction.focused &&
        !interaction.dragging &&
        time >= interaction.holdUntil;
      if (running) {
        // Preserve fractional pixels so high refresh rate displays move at the same speed.
        remainder += (elapsed * (variant === "trending" ? 36 : 30)) / 1000;
        const pixels = Math.floor(remainder);
        remainder -= pixels;
        if (pixels) {
          viewport!.scrollLeft += pixels;
          normalize();
        }
      } else remainder = 0;
      frame = requestAnimationFrame(tick);
    }
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    intersection.observe(viewport);
    viewport.addEventListener("scroll", normalize, { passive: true });
    window.addEventListener("resize", measure);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      viewport.removeEventListener("scroll", normalize);
      window.removeEventListener("resize", measure);
    };
  }, [items.length, variant]);

  function advance(direction: number) {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group || !items.length) return;
    state.current.holdUntil = performance.now() + 1800;
    viewport.scrollBy({
      left: (direction * group.getBoundingClientRect().width) / items.length,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function releasePointer() {
    state.current.dragging = false;
    state.current.holdUntil = performance.now() + 1800;
  }

  return (
    <div
      ref={rootRef}
      className={`b2c-slider b2c-${variant}-slider`}
      role="region"
      aria-label={label}
      aria-roledescription="carousel"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") state.current.hovered = true;
      }}
      onPointerLeave={() => {
        state.current.hovered = false;
      }}
      onFocusCapture={() => {
        state.current.focused = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          state.current.focused = false;
      }}
    >
      <div className="b2c-slider-controls">
        <button
          type="button"
          aria-label={`Previous ${label}`}
          onClick={() => advance(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label={`${stopped ? "Resume" : "Pause"} ${label}`}
          aria-pressed={stopped}
          onClick={() => setStopped(!stopped)}
        >
          {stopped ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button
          type="button"
          aria-label={`Next ${label}`}
          onClick={() => advance(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div
        ref={viewportRef}
        className="b2c-slider-viewport"
        tabIndex={0}
        aria-label={`${label} cards`}
        onPointerDown={() => {
          state.current.dragging = true;
        }}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onWheel={() => {
          state.current.holdUntil = performance.now() + 1800;
        }}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault();
            advance(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        <div className="b2c-slider-track">
          {[0, 1, 2].map((copy) => (
            <div
              key={copy}
              ref={copy === 1 ? groupRef : undefined}
              className={`b2c-slider-group${copy !== 1 ? " b2c-slider-copy" : ""}`}
              aria-hidden={copy !== 1 ? true : undefined}
            >
              {items.map((item, index) => (
                <div className="b2c-slide" key={index}>
                  {renderItem(item, index, copy !== 1)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
