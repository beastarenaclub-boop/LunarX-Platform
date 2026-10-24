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
    const visibleHeight = viewport && viewport.scale === 1 ? viewport.height : window.innerHeight;
    // A demo/session banner sits above the game. Using the whole viewport here
    // creates a second page scrollbar and pushes the betting dock off screen.
    const top = Math.max(0, host.getBoundingClientRect().top + window.scrollY);
    const height = Math.max(1, Math.floor(visibleHeight - top));
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
  const observeChrome = () => {
    for (let sibling = host.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      resize.observe(sibling);
    }
    queue();
  };
  observeChrome();
  const chrome = new MutationObserver(observeChrome);
  if (host.parentElement) chrome.observe(host.parentElement, { childList: true });
  window.addEventListener("resize", queue);
  window.visualViewport?.addEventListener("resize", queue);
  document.fonts.ready.then(queue);
  return () => {
    disposed = true;
    cancelAnimationFrame(scheduled);
    resize.disconnect();
    chrome.disconnect();
    window.removeEventListener("resize", queue);
    window.visualViewport?.removeEventListener("resize", queue);
    host.style.removeProperty("height");
    surface.style.removeProperty("--fit-height");
    surface.style.removeProperty("--game-fit");
    delete host.dataset.fitScale;
  };
}
