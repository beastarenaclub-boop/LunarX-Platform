/** The performance stores RGB in its top 1080 rows and the tracked host matte
 * in the bottom 270. Both are decoded together, so foreground hands and the
 * background can never drift apart. H.264 also works on mobile Safari. */
export function createHostForeground(studio: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.className = "w20-host-foreground";
  canvas.width = 960;
  canvas.height = 540;
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  const matte = document.createElement("canvas");
  matte.width = 480;
  matte.height = 270;
  const mask = matte.getContext("2d", { willReadFrequently: true });
  studio.append(canvas);
  return {
    hide() {
      canvas.hidden = true;
    },
    draw(video: HTMLVideoElement, time: number) {
      if (!context || !mask || video.videoHeight !== 1350) {
        canvas.hidden = true;
        return;
      }
      mask.drawImage(video, 0, 1080, 1920, 270, 0, 0, 480, 270);
      const pixels = mask.getImageData(0, 0, 480, 270);
      for (let i = 0; i < pixels.data.length; i += 4) {
        // H.264 can lift black matte samples slightly at the packed boundary.
        // Keep empty stage pixels fully transparent, including that seam.
        pixels.data[i + 3] =
          pixels.data[i] < 24 ? 0 : pixels.data[i] > 235 ? 255 : pixels.data[i];
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
      mask.putImageData(pixels, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, 960, 540);
      context.drawImage(video, 0, 0, 1920, 1080, 0, 0, 960, 540);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(matte, 0, 0, 960, 540);
      canvas.dataset.frameTime = time.toFixed(3);
      canvas.hidden = false;
    },
    dispose() {
      canvas.remove();
    },
  };
}
