import * as T from "three";

/** A photographic softbox rig, without the stock room's reflected furniture. */
export function studioEnvironment(renderer: T.WebGLRenderer) {
  const room = new T.Scene();
  room.background = new T.Color("#24302c");
  const panels: T.Mesh[] = [];
  function softbox(
    w: number,
    h: number,
    p: [number, number, number],
    intensity: number,
    tint: string,
  ) {
    const panel = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({
        color: new T.Color(tint).multiplyScalar(intensity),
        side: T.DoubleSide,
      }),
    );
    panel.position.set(...p);
    panel.lookAt(0, 1, 0);
    panels.push(panel);
    room.add(panel);
  }
  softbox(3.4, 2.8, [-4, 5, 6], 7, "#fff6e7");
  softbox(0.65, 5.5, [5, 3, 3], 9, "#eff8ff");
  softbox(6, 0.8, [0, 7, -1], 6, "#fff1d7");
  softbox(4, 4.8, [-5, 2, -4], 1.1, "#bba270");
  softbox(4.5, 5, [5, 2, -5], 0.7, "#bca066");
  softbox(12, 10, [0, -3, 0], 0.45, "#183d2e");
  const generator = new T.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0.035, 0.1, 50);
  generator.dispose();
  panels.forEach((p) => {
    p.geometry.dispose();
    (p.material as T.Material).dispose();
  });
  return target;
}

/** Fine machining variation, never painted lighting or baked highlights. */
export function brushedMetalTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#dedede";
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const value = 205 + Math.floor((Math.sin(y * 91.7) * 0.5 + 0.5) * 40);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(2, 5);
  return texture;
}

/** Molded polymer and lacquer have a fine, irregular finish at close range. */
export function surfaceMicrotexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(256, 256);
  let seed = 9182;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 225 + (seed % 25);
    pixels.data.set([value, value, value, 255], i);
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export function contactShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
  gradient.addColorStop(0, "rgba(0,0,0,.65)");
  gradient.addColorStop(0.45, "rgba(0,0,0,.27)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new T.CanvasTexture(canvas);
}
