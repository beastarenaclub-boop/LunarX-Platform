import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Target = { id: string; after: boolean };
type Gesture = { id: string; pointerId: number; x: number; y: number; startX: number; startY: number; active: boolean; handle: HTMLButtonElement; target: Target | null };

/** Pointer handles support mouse, pen and touch without blocking list scrolling.
 * Only commit on drop; cancellation never changes the draft order. */
export function useLobbyReorder({ order, onMove, disabled, resetKey, name }: {
  order: string[]; onMove: (id: string, position: number) => void;
  disabled: boolean; resetKey: string; name: (id: string) => string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef(0);
  const latest = useRef({ order, onMove, disabled, name });
  latest.current = { order, onMove, disabled, name };
  const [drag, setDrag] = useState<{ id: string; target: Target | null } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function cancel() {
    cancelAnimationFrame(frame.current);
    const g = gesture.current;
    gesture.current = null;
    if (g?.handle.hasPointerCapture(g.pointerId)) g.handle.releasePointerCapture(g.pointerId);
    setDrag(null);
  }
  useEffect(() => { cancel(); }, [resetKey, disabled]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) { cancel(); setAnnouncement("Move cancelled."); }
    };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel(); window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  function findTarget(g: Gesture) {
    const row = document.elementsFromPoint(g.x, g.y)
      .map(el => el.closest<HTMLElement>("[data-lobby-sort-id]"))
      .find(el => el && listRef.current?.contains(el));
    const id = row?.dataset.lobbySortId;
    const target = row && id && id !== g.id
      ? { id, after: g.y > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 }
      : null;
    if (target?.id !== g.target?.id || target?.after !== g.target?.after) {
      g.target = target; setDrag({ id: g.id, target });
    }
  }
  function tick() {
    const g = gesture.current;
    if (!g?.active) return;
    if (previewRef.current) previewRef.current.style.transform = `translate(${Math.max(8, Math.min(innerWidth - 248, g.x + 16))}px, ${Math.max(8, Math.min(innerHeight - 80, g.y + 16))}px)`;
    // Scroll the panel's nearest scrollable ancestor, or the page itself.
    let scroller: HTMLElement | null = listRef.current?.parentElement ?? null;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    const bounds = scroller?.getBoundingClientRect();
    const top = Math.max(0, bounds?.top ?? 0), bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight);
    const listBounds = listRef.current?.getBoundingClientRect();
    if (listBounds && g.x >= listBounds.left && g.x <= listBounds.right && g.y >= top && g.y <= bottom) {
      const delta = g.y < top + 70 ? -12 : g.y > bottom - 70 ? 12 : 0;
      if (delta) (scroller ?? window).scrollBy(0, delta);
    }
    findTarget(g);
    frame.current = requestAnimationFrame(tick);
  }
  function down(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (latest.current.disabled || !event.isPrimary || event.button !== 0 || gesture.current) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, handle: event.currentTarget, target: null };
  }
  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.x = event.clientX; g.y = event.clientY;
    if (!g.active && Math.hypot(g.x - g.startX, g.y - g.startY) >= 6) {
      g.active = true; setDrag({ id: g.id, target: null });
      setAnnouncement(`Moving ${latest.current.name(g.id)}. Drop on a game to reorder. Escape cancels.`);
      tick();
    }
    if (g.active) { event.preventDefault(); findTarget(g); }
  }
  function up(event: ReactPointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    g.x = event.clientX; g.y = event.clientY;
    if (g.active) findTarget(g);
    const { order, onMove, disabled, name } = latest.current;
    if (g.active && g.target && !disabled) {
      const from = order.indexOf(g.id), target = order.indexOf(g.target.id);
      if (from >= 0 && target >= 0) {
        const insertion = target + Number(g.target.after);
        const position = insertion - Number(from < insertion) + 1;
        if (position !== from + 1) {
          onMove(g.id, position);
          setAnnouncement(`${name(g.id)} moved to position ${position}. Save changes to publish.`);
        }
      }
    }
    cancel();
  }
  function handleProps(id: string) {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => down(event, id),
      onPointerMove: pointerMove, onPointerUp: up,
      onPointerCancel: cancel, onLostPointerCapture: cancel,
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (gesture.current || disabled || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const position = order.indexOf(id) + (event.key === "ArrowUp" ? 0 : 2);
        if (position >= 1 && position <= order.length) {
          onMove(id, position); setAnnouncement(`${name(id)} moved to position ${position}. Save changes to publish.`);
        }
      },
    };
  }
  return { listRef, previewRef, drag, announcement, handleProps };
}
