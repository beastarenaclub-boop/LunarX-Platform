// Offline face compositor. Not imported by the game or downloaded by players.
import { FaceLandmarker, FilesetResolver } from "/vendor/vision_bundle.mjs";
const Delaunator = window.Delaunator;

const W = 864,
  H = 496;
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
const INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87,
  178, 88, 95,
];
const ovalSet = new Set(OVAL);
const makeCanvas = (w = W, h = H) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const canvas = makeCanvas(),
  ctx = canvas.getContext("2d", { willReadFrequently: true });
const patchCanvas = makeCanvas(140, 170),
  pc = patchCanvas.getContext("2d");
const detectCanvas = makeCanvas(540, 570),
  dc = detectCanvas.getContext("2d");
const maskCanvas = makeCanvas(),
  mc = maskCanvas.getContext("2d", { willReadFrequently: true });
const blurCanvas = makeCanvas(),
  bc = blurCanvas.getContext("2d", { willReadFrequently: true });
const vision = await FilesetResolver.forVisionTasks("/wasm");
const detector = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "/vendor/face_landmarker.task",
    delegate: "CPU",
  },
  runningMode: "IMAGE",
  numFaces: 1,
  minFaceDetectionConfidence: 0.4,
  minFacePresenceConfidence: 0.4,
});
const video = document.createElement("video");
document.body.append(video);
video.muted = true;
video.preload = "auto";
video.src = "/original.mp4";
await new Promise((resolve, reject) => {
  video.onloadeddata = resolve;
  video.onerror = reject;
  video.load();
});
const reference = new Image();
reference.src = "/reference.jpg";
await reference.decode();
const rc = makeCanvas(reference.width, reference.height),
  rctx = rc.getContext("2d", { willReadFrequently: true });
rctx.drawImage(reference, 0, 0);
const refPixels = rctx.getImageData(0, 0, rc.width, rc.height).data;
const refDetection = detector.detect(reference).faceLandmarks[0];
if (!refDetection) throw Error("Reference face not detected");
const refPts = refDetection.map((p) => [p.x * rc.width, p.y * rc.height]);
const triangles = Array.from(Delaunator.from(refPts).triangles);
const eyeSet = new Set(
  [
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
    ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
  ].flatMap((e) => [e.start, e.end]),
);
let landmarks = [],
  basePts,
  offsets,
  gain,
  idleBase;

async function seek(i) {
  await new Promise((resolve, reject) => {
    const time = (i + 0.15) / 24;
    const timeout = setTimeout(() => {
      if (
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - time) < 0.005
      )
        resolve();
      else
        reject(
          Error(
            `Decode timeout at frame ${i}: ready ${video.readyState}, seeking ${video.seeking}`,
          ),
        );
    }, 5000);
    video.onseeked = () => {
      clearTimeout(timeout);
      resolve();
    };
    video.currentTime = time;
  });
  ctx.drawImage(video, 0, 0, W, H);
}
function detect() {
  dc.drawImage(video, 350, 10, 180, 190, 0, 0, 540, 570);
  const found = detector.detect(detectCanvas).faceLandmarks[0];
  if (!found) throw Error("Dealer face not detected");
  return found.map((p) => [350 + p.x * 180, 10 + p.y * 190]);
}
function similarity(from, to) {
  const u = from[263][0] - from[33][0],
    v = from[263][1] - from[33][1];
  const x = to[263][0] - to[33][0],
    y = to[263][1] - to[33][1],
    d = u * u + v * v;
  const a = (u * x + v * y) / d,
    b = (u * y - v * x) / d;
  return {
    a,
    b,
    tx: to[33][0] - a * from[33][0] + b * from[33][1],
    ty: to[33][1] - b * from[33][0] - a * from[33][1],
  };
}
function apply(p, m) {
  return [m.a * p[0] - m.b * p[1] + m.tx, m.b * p[0] + m.a * p[1] + m.ty];
}
function polygon(points, indices, blur = 0) {
  mc.clearRect(0, 0, W, H);
  mc.fillStyle = "#fff";
  mc.beginPath();
  indices.forEach((k, i) =>
    i ? mc.lineTo(...points[k]) : mc.moveTo(...points[k]),
  );
  mc.closePath();
  mc.fill();
  bc.clearRect(0, 0, W, H);
  bc.filter = `blur(${blur}px)`;
  bc.drawImage(maskCanvas, 0, 0);
  bc.filter = "none";
  return bc.getImageData(0, 0, W, H).data;
}
function skinMean(pixels, width, points) {
  const out = [0, 0, 0];
  let count = 0;
  for (const k of [50, 280, 101, 330, 205, 425]) {
    const [px, py] = points[k].map(Math.round);
    for (let y = py - 1; y <= py + 1; y++)
      for (let x = px - 1; x <= px + 1; x++) {
        const n = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) out[c] += pixels[n + c];
        count++;
      }
  }
  return out.map((x) => x / count);
}
// Rasterize inverse barycentric coordinates once; all triangles share exact
// edge coordinates, avoiding the hairline gaps produced by clipped canvases.
function warp(pixels, sw, sh, from, to) {
  const rgb = new Uint8ClampedArray(W * H * 4);
  for (let n = 0; n < triangles.length; n += 3) {
    const ids = triangles.slice(n, n + 3),
      [p, q, r] = ids.map((k) => to[k]),
      [s, t, u] = ids.map((k) => from[k]);
    const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    if (Math.abs(det) < 0.001) continue;
    const x0 = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0]))),
      x1 = Math.min(W - 1, Math.ceil(Math.max(p[0], q[0], r[0])));
    const y0 = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1]))),
      y1 = Math.min(H - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const a =
          ((q[1] - r[1]) * (x + 0.5 - r[0]) +
            (r[0] - q[0]) * (y + 0.5 - r[1])) /
          det;
        const b =
            ((r[1] - p[1]) * (x + 0.5 - r[0]) +
              (p[0] - r[0]) * (y + 0.5 - r[1])) /
            det,
          c = 1 - a - b;
        if (a < -0.002 || b < -0.002 || c < -0.002) continue;
        const sx = Math.max(
            0,
            Math.min(sw - 1.001, a * s[0] + b * t[0] + c * u[0]),
          ),
          sy = Math.max(
            0,
            Math.min(sh - 1.001, a * s[1] + b * t[1] + c * u[1]),
          );
        const ix = Math.floor(sx),
          iy = Math.floor(sy),
          fx = sx - ix,
          fy = sy - iy,
          src = (iy * sw + ix) * 4,
          dst = (y * W + x) * 4;
        for (let k = 0; k < 3; k++)
          rgb[dst + k] =
            pixels[src + k] * (1 - fx) * (1 - fy) +
            pixels[src + 4 + k] * fx * (1 - fy) +
            pixels[src + sw * 4 + k] * (1 - fx) * fy +
            pixels[src + sw * 4 + 4 + k] * fx * fy;
        rgb[dst + 3] = 255;
      }
  }
  return rgb;
}
window.scan = async () => {
  for (let i = 0; i < 361; i++) {
    await seek(i);
    landmarks.push(detect());
    if (i % 60 === 0) console.log("Tracked", i);
  }
  // Centered three-frame smoothing reduces detection shimmer without lag.
  const raw = landmarks;
  landmarks = raw.map((points, i) =>
    i < 144 || i === 144 || i === 360
      ? points
      : points.map((p, k) =>
          p.map(
            (v, j) => 0.6 * v + 0.2 * raw[i - 1][k][j] + 0.2 * raw[i + 1][k][j],
          ),
        ),
  );
  basePts = landmarks[0];
  const m = similarity(refPts, basePts);
  offsets = refPts.map((p, k) => {
    const q = apply(p, m);
    return [q[0] - basePts[k][0], q[1] - basePts[k][1]];
  });
  await seek(0);
  const base = ctx.getImageData(0, 0, W, H).data;
  const a = skinMean(base, W, basePts),
    b = skinMean(refPixels, rc.width, refPts);
  gain = a.map((v, k) => Math.max(0.88, Math.min(1.12, v / b[k])));
  console.log(
    "Face registration",
    JSON.stringify({
      gain,
      reference: refPts[1],
      base: basePts[1],
      triangles: triangles.length / 3,
    }),
  );
  return { landmarks, reference: refPts, gain };
};
window.renderFrame = async (i, full = true) => {
  await seek(i);
  const source = ctx.getImageData(0, 0, W, H),
    original = source.data.slice();
  const points = landmarks[i],
    pose = similarity(basePts, points);
  let targets = points.map((p, k) => {
    const weight = ovalSet.has(k) ? 0.12 : 1;
    const d = offsets[k];
    return [
      p[0] + weight * (pose.a * d[0] - pose.b * d[1]),
      p[1] + weight * (pose.b * d[0] + pose.a * d[1]),
    ];
  });
  if (i < 144) {
    targets = basePts.map((p, k) => {
      const weight = ovalSet.has(k) ? 0.12 : 1;
      return [
        p[0] +
          weight * offsets[k][0] +
          (eyeSet.has(k) ? points[k][0] - basePts[k][0] : 0),
        p[1] +
          weight * offsets[k][1] +
          (eyeSet.has(k) ? points[k][1] - basePts[k][1] : 0),
      ];
    });
  }
  const face = warp(refPixels, rc.width, rc.height, refPts, targets),
    alpha = polygon(targets, OVAL, 1.25);
  for (let p = 0; p < original.length; p += 4) {
    const a = (alpha[p + 3] / 255) * (face[p + 3] / 255);
    if (a)
      for (let k = 0; k < 3; k++)
        source.data[p + k] =
          original[p + k] * (1 - a) + face[p + k] * gain[k] * a;
  }
  // Keep genuine inner-mouth detail when the recorded action opens the mouth.
  // The new outer lips and every other facial feature retain the new identity.
  if (i >= 144 && points[14][1] - points[13][1] > 0.8) {
    const mouth = warp(original, W, H, points, targets),
      ma = polygon(targets, INNER, 0.35);
    for (let p = 0; p < original.length; p += 4) {
      const a = (ma[p + 3] / 255) * (mouth[p + 3] / 255);
      if (a)
        for (let k = 0; k < 3; k++)
          source.data[p + k] = source.data[p + k] * (1 - a) + mouth[p + k] * a;
    }
  }
  if (i === 0) idleBase = source.data.slice();
  if (i < 144) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x >= 405 && x <= 479 && y >= 82 && y <= 108) continue;
        const p = (y * W + x) * 4;
        for (let c = 0; c < 4; c++) source.data[p + c] = idleBase[p + c];
      }
  } else {
    for (let p = 200 * W * 4; p < original.length; p++)
      if (source.data[p] !== original[p])
        throw Error("Changed body/cards outside the face");
  }
  ctx.putImageData(source, 0, 0);
  pc.drawImage(canvas, 375, 20, 140, 170, 0, 0, 140, 170);
  return {
    patch: patchCanvas.toDataURL("image/png").split(",")[1],
    full: full ? canvas.toDataURL("image/png").split(",")[1] : null,
  };
};
window.faceReady = true;
