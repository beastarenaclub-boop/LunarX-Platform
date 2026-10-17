/** Keep the game in the visible browser without shrinking text or touch targets. */
export function fitGameViewport(
  host: HTMLElement,
  surface: HTMLElement,
  native = false,
) {
  let scheduled = 0,
    disposed = false;
  const measure = () => {
    scheduled = 0;
    if (disposed) return;
    const viewport = window.visualViewport;
    // Pinch zoom must magnify the existing layout, not reflow it into a smaller box.
    const height = Math.round(viewport && viewport.scale === 1 ? viewport.height : window.innerHeight);
    host.style.height = `${height}px`;
    const style = getComputedStyle(host);
    const available = host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    // Keep the compact controls usable when the on-screen keyboard reduces the viewport.
    const minimum = native
      ? host.clientWidth < 761 && window.innerHeight > window.innerWidth
        ? 500
        : 280
      : 0;
    surface.style.setProperty(
      "--fit-height",
      `${Math.max(available, minimum)}px`,
    );
    // Layouts reflow at their own breakpoints. Short windows/soft keyboards
    // use the frame's vertical scroll instead of scaling every control down.
    surface.style.setProperty("--game-fit", "1");
    host.dataset.fitScale = "1.000";
  };
  const queue = () => {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(measure);
  };
  measure();
  const resize = new ResizeObserver(queue);
  resize.observe(host);
  window.addEventListener("resize", queue);
  window.visualViewport?.addEventListener("resize", queue);
  document.fonts.ready.then(queue);
  return () => {
    disposed = true;
    cancelAnimationFrame(scheduled);
    resize.disconnect();
    window.removeEventListener("resize", queue);
    window.visualViewport?.removeEventListener("resize", queue);
    host.style.removeProperty("height");
    surface.style.removeProperty("--fit-height");
    surface.style.removeProperty("--game-fit");
    delete host.dataset.fitScale;
  };
}
