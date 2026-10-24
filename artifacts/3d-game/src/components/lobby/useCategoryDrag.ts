import { useEffect, type RefObject } from "react";
import "./category-drag.css";

/** Add mouse/pen dragging while leaving native touch scrolling to the browser. */
export function useCategoryDrag(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const nav = ref.current;
    if (!nav || !enabled) return;
    let gesture: { id: number; x: number; y: number; left: number; dragging: boolean } | null = null;
    let suppressClick = false;
    let resetClick: ReturnType<typeof setTimeout> | undefined;
    nav.dataset.dragScroll = "";

    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0 || !event.isPrimary || nav.scrollWidth <= nav.clientWidth) return;
      clearTimeout(resetClick);
      suppressClick = false;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: nav.scrollLeft, dragging: false };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.abs(dx) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
        gesture.dragging = true;
        nav.dataset.dragging = "";
        nav.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      nav.scrollLeft = gesture.left - dx;
    };
    const finish = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      suppressClick = gesture.dragging;
      gesture = null;
      delete nav.dataset.dragging;
      if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
      // Suppress only the click produced by releasing this drag, never a later tap.
      resetClick = setTimeout(() => { suppressClick = false; }, 0);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    const preventNativeDrag = (event: DragEvent) => event.preventDefault();

    nav.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    nav.addEventListener("lostpointercapture", finish);
    nav.addEventListener("click", click, true);
    nav.addEventListener("dragstart", preventNativeDrag);
    return () => {
      clearTimeout(resetClick);
      nav.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      nav.removeEventListener("lostpointercapture", finish);
      nav.removeEventListener("click", click, true);
      nav.removeEventListener("dragstart", preventNativeDrag);
      if (gesture && nav.hasPointerCapture(gesture.id)) nav.releasePointerCapture(gesture.id);
      delete nav.dataset.dragScroll;
      delete nav.dataset.dragging;
    };
  }, [ref, enabled]);
}
