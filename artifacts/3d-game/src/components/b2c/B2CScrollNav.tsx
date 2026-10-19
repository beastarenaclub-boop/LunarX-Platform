import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Keep every category reachable by touch, keyboard and explicit scroll controls. */
export function B2CScrollNav({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, previous: false, next: false });

  useEffect(() => {
    const root = rootRef.current;
    const nav = navRef.current;
    if (!root || !nav) return;
    const measure = () => {
      const next = {
        overflow: nav.scrollWidth > root.clientWidth + 1,
        previous: nav.scrollLeft > 1,
        next: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
      };
      setScroll(current => current.overflow === next.overflow
        && current.previous === next.previous && current.next === next.next ? current : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    resize.observe(nav);
    nav.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      nav.removeEventListener("scroll", measure);
    };
  }, []);

  function move(left: number) {
    navRef.current?.scrollBy({
      left,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  function reveal(target: EventTarget) {
    const nav = navRef.current;
    const button = target instanceof Element ? target.closest("button") : null;
    if (!nav || !button || !nav.contains(button)) return;
    const bounds = nav.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.left < bounds.left) move(item.left - bounds.left);
    else if (item.right > bounds.right) move(item.right - bounds.right);
  }

  return (
    <div ref={rootRef} className="b2c-category-scroll" data-overflow={scroll.overflow}>
      <button type="button" className="b2c-category-arrow" aria-label="Previous game categories"
        disabled={!scroll.previous} onClick={() => move(-(navRef.current?.clientWidth ?? 0) * .8)}>
        <ChevronLeft size={18} />
      </button>
      <nav ref={navRef} aria-label="Casino game types"
        onClick={event => reveal(event.target)} onFocus={event => reveal(event.target)}>
        {children}
      </nav>
      <button type="button" className="b2c-category-arrow" aria-label="Next game categories"
        disabled={!scroll.next} onClick={() => move((navRef.current?.clientWidth ?? 0) * .8)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
