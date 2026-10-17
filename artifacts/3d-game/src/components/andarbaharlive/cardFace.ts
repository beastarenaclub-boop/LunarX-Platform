const suits = ["\u2660", "\u2665", "\u2666", "\u2663"];
const ranks = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const faces = new Map<number, HTMLCanvasElement>();

/** Jumbo indices match the physical cards in the recording. Power-of-two
 * textures allow mipmaps, keeping thin edges stable at table distance. */
export function cardFace(card: number) {
  const cached = faces.get(card);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.scale(512 / 100, 512 / 140);
  ctx.fillStyle = "#f9f6ed";
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, 99, 139, 3);
  ctx.fill();
  ctx.strokeStyle = "#d1c5ad";
  ctx.lineWidth = 1;
  ctx.stroke();
  const suit = Math.floor(card / 13);
  const ink = suit === 1 || suit === 2 ? "#ad1025" : "#16151a";
  for (let side = 0; side < 2; side++) {
    ctx.save();
    if (side) {
      ctx.translate(100, 140);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = "bold 57px Arial";
    ctx.fillText(ranks[card % 13], 7, 57, 49);
    ctx.textAlign = "center";
    ctx.font = "bold 45px Georgia";
    ctx.fillText(suits[suit], 77, 55, 36);
    ctx.restore();
  }
  ctx.strokeStyle = "#b9b7ad";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(41, 63, 18, 14);
  for (let y = 66; y < 76; y += 3) {
    ctx.beginPath();
    ctx.moveTo(43, y);
    ctx.lineTo(57, y);
    ctx.stroke();
  }
  faces.set(card, c);
  return c;
}
