export function handMask(pixels, width, height) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4,
      r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    mask[p] = Number(
      r > 65 &&
        g > 30 &&
        b > 15 &&
        r - g > 20 &&
        g - b > 3 &&
        g - b < 70 &&
        r - g > (g - b) * 0.8 &&
        r - g < (g - b) * 3.8 &&
        r > g * 1.2 &&
        r < g * 2.4,
    );
  }
  const seen = new Uint8Array(mask.length),
    kept = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || seen[p]) continue;
    let head = 0,
      size = 1;
    queue[0] = p;
    seen[p] = 1;
    while (head < size) {
      const at = queue[head++],
        x = at % width,
        y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
            continue;
          const n = at + dy * width + dx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            queue[size++] = n;
          }
        }
    }
    if (size >= 120) for (let i = 0; i < size; i++) kept[queue[i]] = 1;
  }
  // Fill small gaps in the skin mask, then retain a one-pixel soft boundary.
  const expanded = new Uint8Array(mask.length);
  for (let p = 0; p < kept.length; p++)
    if (kept[p]) {
      const x = p % width,
        y = Math.floor(p / width);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
            expanded[p + dy * width + dx] = 1;
    }
  for (let p = 0; p < kept.length; p++) {
    const x = p % width,
      y = Math.floor(p / width);
    kept[p] = Number(
      expanded[p] &&
        (x === 0 || expanded[p - 1]) &&
        (x === width - 1 || expanded[p + 1]) &&
        (y === 0 || expanded[p - width]) &&
        (y === height - 1 || expanded[p + width]),
    );
  }
  return kept;
}

// A continuous colour key prevents the binary mask's expanded boundary from
// restoring white paper and black printed pips beside the dealer's fingers.
export function softHandMask(pixels, width, height) {
  const connected = handMask(pixels, width, height);
  const alpha = new Uint8Array(connected.length);
  const ramp = (n) => Math.max(0, Math.min(1, n));
  for (let p = 0; p < connected.length; p++) {
    if (!connected[p]) continue;
    const r = pixels[p * 4],
      g = pixels[p * 4 + 1],
      b = pixels[p * 4 + 2];
    const red = r - g,
      yellow = g - b;
    alpha[p] = Math.round(
      255 *
        Math.min(
          ramp((r - 55) / 25),
          ramp((g - 22) / 20),
          ramp((b - 8) / 15),
          ramp((red - 16) / 12),
          ramp((yellow - 1) / 7),
          ramp((76 - yellow) / 10),
          ramp((red - yellow * 0.75) / 12),
          ramp((yellow * 4 - red) / 12),
          ramp((r - g * 1.15) / 14),
          ramp((g * 2.5 - r) / 20),
        ),
    );
  }
  return alpha;
}
