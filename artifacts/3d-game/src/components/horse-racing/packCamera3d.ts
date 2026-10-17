import * as THREE from "three";
import { RUNNER_HEIGHT, RUNNER_LENGTH } from "./broadcastHorse3d";

type RunnerPoint = { x: number; z: number; heading: number };
/** Frame the whole live field, including the physical extent of each horse. */
export function packCamera() {
  const forward = new THREE.Vector3();
  const back = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const corner = new THREE.Vector3();
  return (
    points: RunnerPoint[],
    mode: string,
    aspect: number,
    target: THREE.Vector3,
    desired: THREE.Vector3,
  ) => {
    forward.set(0, 0, 0);
    target.set(0, 1.55, 0);
    for (const p of points) {
      const dx = Math.sin(p.heading),
        dz = Math.cos(p.heading);
      forward.x += dx;
      forward.z += dz;
      target.x += (p.x - dx * 1.45) / points.length;
      target.z += (p.z - dz * 1.45) / points.length;
    }
    forward.normalize();
    const tight = mode === "closeup" || mode === "winner" || mode === "parade";
    const elevation = THREE.MathUtils.degToRad(
      mode === "parade"
        ? 9
        : tight
          ? 12
          : mode === "rail"
            ? 10
            : mode === "grandstand"
              ? 48
              : mode === "headon"
                ? 12
                : 26,
    );
    back
      .set(-forward.z - forward.x * 0.32, 0, forward.x - forward.z * 0.32)
      .normalize();
    if (mode === "headon")
      back
        .copy(forward)
        .addScaledVector(new THREE.Vector3(-forward.z, 0, forward.x), 0.12)
        .normalize();
    if (mode === "parade" || mode === "winner")
      back
        .set(-forward.z + forward.x * 0.6, 0, forward.x + forward.z * 0.6)
        .normalize();
    back.multiplyScalar(Math.cos(elevation));
    back.y = Math.sin(elevation);
    right.set(back.z, 0, -back.x).normalize();
    up.crossVectors(back, right).normalize();
    const fov = tight ? 36 : mode === "grandstand" ? 40 : 32;
    const padding = tight
      ? 0.85
      : mode === "rail"
        ? 0.73
        : mode === "grandstand"
          ? 0.48
          : 0.65;
    const vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * padding;
    const horizontal = vertical * aspect;
    let distance = mode === "parade" || mode === "winner" ? 9 : 12;
    for (const p of points) {
      for (const x of [-RUNNER_LENGTH, RUNNER_LENGTH * 0.12]) {
        for (const y of [-0.08, RUNNER_HEIGHT + 0.4]) {
          for (const side of [-0.7, 0.7]) {
            corner
              .set(
                p.x + Math.sin(p.heading) * x + Math.cos(p.heading) * side,
                y,
                p.z + Math.cos(p.heading) * x - Math.sin(p.heading) * side,
              )
              .sub(target);
            const depth = corner.dot(back);
            distance = Math.max(
              distance,
              depth + Math.abs(corner.dot(right)) / horizontal,
              depth + Math.abs(corner.dot(up)) / vertical,
            );
          }
        }
      }
    }
    desired.copy(target).addScaledVector(back, distance);
    if (mode === "parade") {
      target.addScaledVector(right, 1.55);
      desired.addScaledVector(right, 1.55);
    }
    return fov;
  };
}
