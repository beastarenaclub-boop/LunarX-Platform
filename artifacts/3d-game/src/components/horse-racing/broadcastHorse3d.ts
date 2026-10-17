import * as THREE from "three";
import { loadCharacters, racingCharacter } from "./raceCharacters3d";

export { loadCharacters as loadBroadcastHorses };
type Models = Awaited<ReturnType<typeof loadCharacters>>;
export const RUNNER_SCALE = 0.78;
export const RUNNER_HEIGHT = 4.15 * RUNNER_SCALE;
export const RUNNER_LENGTH = 5.5 * RUNNER_SCALE;

/** A skinned horse and mounted jockey, with its nose aligned to race progress. */
export function broadcastHorse(
  models: Models,
  color: string,
  coat: string,
  id: number,
) {
  const character = racingCharacter(models, color, coat, id);
  const mesh = character.root;
  mesh.scale.setScalar(RUNNER_SCALE);
  mesh.updateMatrixWorld(true);
  // Hair cards extend below their visible pixels. Ground the actual hoof
  // anchors instead of the full mesh bounds, which leave the horse floating.
  const groundOffset =
    0.015 - Math.min(...character.hoofPositions().map((point) => point.y));
  const groundCenter = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#16231d";
  context.lineWidth = 4;
  context.font = "italic bold 96px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeText(String(id), 64, 70);
  context.fillText(String(id), 64, 70);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const clothMaterial = new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const number = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.62),
      clothMaterial,
    );
    number.position.set(side * 0.69, 2.0, -0.18);
    number.rotation.y = (side * Math.PI) / 2;
    number.rotation.x = -0.12;
    mesh.add(number);
  }
  let frame = 0;
  return {
    mesh,
    groundCenter,
    get frame() {
      return frame;
    },
    setDetail: character.setDetail,
    hoofPositions: character.hoofPositions,
    update(
      point: { x: number; z: number; heading: number },
      time: number,
      running: boolean,
      phase: number,
      stride: number,
    ) {
      const gait = running
        ? Math.max(0, time) * stride * 1.65 + phase
        : Math.max(0, time) * 0.35 + phase;
      character.animate(gait, running);
      // The mounted pose follows the horse's suspension without exaggerated rocking.
      character.jockey.position.y = running
        ? Math.sin(gait * Math.PI * 2) * 0.045
        : 0;
      character.jockey.rotation.x = running
        ? Math.sin(gait * Math.PI * 2 + 0.6) * 0.025
        : 0;
      mesh.rotation.y = point.heading;
      mesh.position.set(point.x, groundOffset, point.z);
      mesh.updateMatrixWorld(true);
      const nose = character.updateTack() * RUNNER_SCALE;
      mesh.position.x -= Math.sin(point.heading) * nose;
      mesh.position.z -= Math.cos(point.heading) * nose;
      groundCenter.set(mesh.position.x, 0, mesh.position.z);
      mesh.updateMatrixWorld(true);
      frame = Math.floor(gait * 24);
    },
    screenBounds(camera: THREE.Camera) {
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      for (const x of [-0.85, 0.85])
        for (const y of [0, 4.15])
          for (const z of [-2.4, 3.05]) {
            corner.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
            const sx = (corner.x + 1) * 640,
              sy = (1 - corner.y) * 360;
            left = Math.min(left, sx);
            right = Math.max(right, sx);
            top = Math.min(top, sy);
            bottom = Math.max(bottom, sy);
          }
      return [left, top, right - left, bottom - top];
    },
    dispose() {
      character.mixer.stopAllAction();
      character.mixer.uncacheRoot(character.horse);
      character.riderMixer.uncacheRoot(character.jockey);
      map.dispose();
    },
  };
}
