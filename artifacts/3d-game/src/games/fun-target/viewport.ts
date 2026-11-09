export const CANVAS_WIDTH = 1024, CANVAS_HEIGHT = 720;
export function viewport(width: number, height: number) {
  const rotated = height > width;
  return { rotated, scaleX: (rotated ? height : width) / CANVAS_WIDTH, scaleY: (rotated ? width : height) / CANVAS_HEIGHT };
}
export function clientToCanvas(x: number, y: number, width: number, height: number) {
  const v = viewport(width, height);
  return v.rotated ? { x: y / v.scaleX, y: (width - x) / v.scaleY } : { x: x / v.scaleX, y: y / v.scaleY };
}
