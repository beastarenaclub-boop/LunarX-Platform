/** The performance stores RGB in its top 1080 rows and the tracked host matte
 * in the bottom 270. Both are decoded together, so foreground hands and the
 * background can never drift apart. H.264 also works on mobile Safari. */
export function createHostForeground(studio: HTMLElement, light = false) {
  const canvas = document.createElement("canvas");
  canvas.className = "w20-host-foreground";
  const width = light ? 640 : 960;
  const height = light ? 360 : 540;
  canvas.width = width;
  canvas.height = height;
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  const matte = document.createElement("canvas");
  matte.width = width / 2;
  matte.height = height / 2;
  const mask = matte.getContext("2d", { willReadFrequently: true });
  studio.append(canvas);
  let lastVideo: HTMLVideoElement | null = null;
  let lastTime = -1;
  return {
    hide() {
      canvas.hidden = true;
    },
    draw(video: HTMLVideoElement, time: number) {
      if (!context || !mask || !video.videoWidth || Math.abs(video.videoWidth / video.videoHeight - 1920 / 1350) > 0.01) {
        canvas.hidden = true;
        return;
      }
      if (lastVideo === video && lastTime === time && !canvas.hidden) return;
      lastVideo = video;
      lastTime = time;
      const rgbHeight = video.videoHeight * 0.8;
      mask.drawImage(video, 0, rgbHeight, video.videoWidth, video.videoHeight - rgbHeight, 0, 0, matte.width, matte.height);
      const pixels = mask.getImageData(0, 0, matte.width, matte.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        // H.264 can lift black matte samples slightly at the packed boundary.
        // Keep empty stage pixels fully transparent, including that seam.
        pixels.data[i + 3] =
          pixels.data[i] < 24 ? 0 : pixels.data[i] > 235 ? 255 : pixels.data[i];
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
      mask.putImageData(pixels, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, width, height);
      context.drawImage(video, 0, 0, video.videoWidth, rgbHeight, 0, 0, width, height);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(matte, 0, 0, width, height);
      canvas.dataset.frameTime = time.toFixed(3);
      canvas.hidden = false;
    },
    dispose() {
      canvas.remove();
    },
  };
}
