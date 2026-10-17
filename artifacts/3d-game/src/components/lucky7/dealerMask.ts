// Soft silhouette of the source take, leaving the surrounding casino video
// visible. Coordinates are normalized to the whole 16:9 source frame.
const silhouette = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><filter id="soft"><feGaussianBlur stdDeviation="4"/></filter></defs><path fill="white" filter="url(#soft)" d="M455 25 C416 34 413 125 407 204 L397 304 C385 342 366 359 352 399 L311 704 C292 754 298 803 333 833 L395 875 L428 948 L566 948 L610 881 C665 883 704 850 706 804 L690 690 L652 430 C642 378 612 357 591 334 L581 260 C576 195 579 97 548 49 C523 17 480 14 455 25Z"/></svg>`;
export const DEALER_MASK = `url("data:image/svg+xml,${encodeURIComponent(silhouette)}")`;
