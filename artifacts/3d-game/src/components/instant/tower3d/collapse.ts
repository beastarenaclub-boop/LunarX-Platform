import * as T from "three";
import { TOWER_BREAK_SECONDS, towerCollapseTiming } from "../towerMotion";

/** Small reusable fracture set. Physics changes transforms only, not geometry. */
export function createCollapse(options: {
  walls: T.Material[]; faces: T.Material[]; trim: T.Material; dark: T.Material;
  ownGeometry: <G extends T.BufferGeometry>(geometry: G) => G;
}) {
  const group = new T.Group(); group.visible = false;
  const cube = options.ownGeometry(new T.BoxGeometry(1, 1, 1));
  const pieces: { model: T.Group; body: T.Mesh; face?: T.Mesh; local: T.Vector3; size: T.Vector3; start: T.Vector3; end: T.Vector3; rest: T.Euler; restY: number; hitAt: number; vy: number; wall: boolean }[] = [];
  const add = (size: T.Vector3, local: T.Vector3, wall: boolean, col?: number, row?: number) => {
    size.multiply(new T.Vector3(.912, 1.6, 1.04)); local.multiply(new T.Vector3(.912, 1.6, 1.04));
    const model = new T.Group(), body = new T.Mesh(cube, wall ? options.walls[0] : options.trim);
    body.scale.copy(size); body.castShadow = true; body.receiveShadow = true; model.add(body);
    let face: T.Mesh | undefined;
    if (col !== undefined && row !== undefined) {
      const plane = options.ownGeometry(new T.PlaneGeometry(size.x, size.y));
      const uv = plane.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 3, (row + uv.getY(i)) / 2);
      face = new T.Mesh(plane, options.faces[0]); face.position.z = size.z / 2 + .003; model.add(face);
    }
    const n = pieces.length;
    const rest = new T.Euler(.35 + (n % 4) * .43, n * 1.73, -.42 + (n % 3) * .38);
    const matrix = new T.Matrix4().makeRotationFromEuler(rest).elements;
    const restY = -.235 + (Math.abs(matrix[1]) * size.x + Math.abs(matrix[5]) * size.y + Math.abs(matrix[9]) * size.z) / 2;
    pieces.push({ model, body, face, local, size, start: new T.Vector3(), end: new T.Vector3(), rest, restY, hitAt: 0, vy: 0, wall }); group.add(model);
  };
  // Six photographic facade pieces, six rear masonry chunks, four roof slabs,
  // and six window/beam fragments. Reuse the original block's materials.
  for (let depth = 0; depth < 2; depth++) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    add(new T.Vector3(2.35 / 3, 1.63 / 2, .9), new T.Vector3((col - 1) * 2.35 / 3, (row - .5) * 1.63 / 2, depth ? -.45 : .45), true, depth ? undefined : col, depth ? undefined : row);
  }
  for (let n = 0; n < 4; n++) add(new T.Vector3(.625, .11, 1.95), new T.Vector3((n - 1.5) * .625, .845, 0), false);
  for (let n = 0; n < 6; n++) add(new T.Vector3(.09, .48, .08), new T.Vector3((n % 3 - 1) * .65, n < 3 ? .3 : -.3, .97), false);
  let preparedStep = -1;
  const tipped = new T.Euler(.24, .06, -.38);
  const sample = { fractured: false, settled: false, impact: false, focusY: 0, impactElapsed: -1, minY: 0, maxY: 0, startY: 0 };
  return {
    group, count: pieces.length,
    update(step: number, elapsed: number, instant = false) {
      const timing = towerCollapseTiming(step);
      if (preparedStep !== step) {
        preparedStep = step;
        pieces.forEach((piece, n) => {
          piece.start.copy(piece.local).applyEuler(tipped).add(new T.Vector3(1.05, timing.height, .55));
          piece.start.y = Math.max(piece.start.y, piece.restY + .05);
          piece.end.set(-.95 + (n % 5) * .43, piece.restY, 1 + Math.floor(n / 5) * .2 + (n % 2) * .15);
          piece.vy = .5 + (n % 4) * .4;
          piece.hitAt = (piece.vy + Math.sqrt(piece.vy ** 2 + 2 * timing.gravity * Math.max(0, piece.start.y - piece.restY))) / timing.gravity;
          piece.body.material = piece.wall ? options.walls[step % options.walls.length] : n >= 16 ? options.dark : options.trim;
          if (piece.face) piece.face.material = options.faces[step % options.faces.length];
        });
      }
      const t = Math.max(0, (instant ? timing.duration : elapsed) - TOWER_BREAK_SECONDS);
      group.visible = instant || elapsed >= TOWER_BREAK_SECONDS;
      sample.fractured = group.visible; sample.settled = instant || elapsed >= timing.duration;
      sample.startY = timing.height; sample.minY = Infinity; sample.maxY = -Infinity;
      let focus = 0;
      pieces.forEach((piece, n) => {
        const travel = Math.min(1, t / piece.hitAt), after = Math.max(0, t - piece.hitAt);
        piece.model.position.lerpVectors(piece.start, piece.end, travel);
        piece.model.position.y = t < piece.hitAt
          ? piece.start.y + piece.vy * t - .5 * timing.gravity * t * t
          : piece.restY + (after < .75 ? Math.abs(Math.sin(after * 13)) * Math.exp(-after * 6) * (.25 + n % 3 * .06) : 0);
        // Spin while falling, settle against the road's actual height, then stay.
        piece.model.rotation.set(
          T.MathUtils.lerp(tipped.x, piece.rest.x + Math.PI * 2, travel),
          T.MathUtils.lerp(tipped.y, piece.rest.y, travel),
          T.MathUtils.lerp(tipped.z, piece.rest.z - Math.PI * 2, travel),
        );
        if (after > 0) piece.model.position.z += .13 * (1 - Math.exp(-after * 7));
        focus += piece.model.position.y;
        sample.minY = Math.min(sample.minY, piece.model.position.y); sample.maxY = Math.max(sample.maxY, piece.model.position.y);
      });
      sample.focusY = focus / pieces.length;
      sample.impactElapsed = (instant ? timing.duration : elapsed) - timing.impact;
      sample.impact = sample.impactElapsed >= 0;
      return sample;
    },
    clear() { group.visible = false; },
  };
}
