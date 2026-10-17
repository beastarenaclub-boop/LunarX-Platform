export const RACE_CAMERAS = [
  {
    id: "broadcast",
    label: "Broadcast",
    hint: "Track the entire field from the side",
  },
  {
    id: "rail",
    label: "Rail-side",
    hint: "Low camera beside the running rail",
  },
  {
    id: "headon",
    label: "Front",
    hint: "Track the field head-on from ahead of the horses",
  },
  {
    id: "grandstand",
    label: "Grandstand",
    hint: "Elevated view following the entire field",
  },
  {
    id: "closeup",
    label: "Close-up",
    hint: "Tight view of all eight runners racing together",
  },
  {
    id: "auto",
    label: "Auto",
    hint: "Horse introductions, directed race cameras and the finish",
  },
] as const;
export type RaceCameraMode = (typeof RACE_CAMERAS)[number]["id"];
export const AVAILABLE_RACE_CAMERAS = RACE_CAMERAS;
export type ManualCamera = Exclude<RaceCameraMode, "auto">;
export const CAMERA_STORAGE_KEY = "horse-racing:camera:v2";
export function savedRaceCamera(): RaceCameraMode {
  try {
    const saved = localStorage.getItem(CAMERA_STORAGE_KEY);
    // The former Realistic selector is now the horse style in every camera.
    return AVAILABLE_RACE_CAMERAS.find((c) => c.id === saved)?.id ?? "auto";
  } catch {
    return "auto";
  }
}
export function activeCamera(
  mode: RaceCameraMode,
  seconds: number,
): ManualCamera {
  if (mode !== "auto") return mode;
  return (["rail", "broadcast", "grandstand", "headon", "closeup"] as const)[
    Math.floor(Math.max(0, seconds) / 5) % 5
  ];
}
export interface CameraPose {
  elevation: number;
  distance: number;
  span: number;
  centerY: number;
  follow: number;
}
export const CAMERA_POSES: Record<ManualCamera, CameraPose> = {
  headon: {
    elevation: (Math.PI * 12) / 180,
    distance: 55,
    span: 64,
    centerY: 0.72,
    follow: 0,
  },
  broadcast: {
    elevation: (Math.PI * 42) / 180,
    distance: 55,
    span: 70,
    centerY: 0.64,
    follow: 0,
  },
  rail: {
    elevation: (Math.PI * 20) / 180,
    distance: 42,
    span: 53,
    centerY: 0.73,
    follow: 0,
  },
  grandstand: {
    elevation: (Math.PI * 61) / 180,
    distance: 72,
    span: 85,
    centerY: 0.59,
    follow: 0,
  },
  closeup: {
    elevation: (Math.PI * 15) / 180,
    distance: 80,
    span: 44,
    centerY: 0.67,
    follow: 0,
  },
};
export const WORLD_METRES = 0.12;
export const TRACK_HALF_WIDTH = 14.5;
export function raceProjection(
  pose: CameraPose,
  lead: number,
  spread: number,
  width = 1280,
  height = 720,
  subject = { x: lead, z: 0 },
) {
  const wideSpan = Math.max(pose.span, (spread + 7) / 0.52);
  const span = wideSpan + (pose.span - wideSpan) * pose.follow;
  const wideFocus = Math.max(span * 0.22, lead - span * 0.2);
  const scale = width / span,
    focus = wideFocus + (subject.x - 2.5 - wideFocus) * pose.follow,
    focusZ = subject.z * pose.follow;
  const sin = Math.sin(pose.elevation),
    cos = Math.cos(pose.elevation),
    cy = height * pose.centerY;
  const factor = (z: number) =>
    pose.distance / (pose.distance - (z - focusZ) * cos);
  const point = (x: number, z: number, y = 0) => {
    const k = pose.distance / (pose.distance - (z - focusZ) * cos + y * sin);
    return {
      x: width * 0.5 + (x - focus) * scale * k,
      y: cy + ((z - focusZ) * sin - y * cos) * scale * k,
      k,
    };
  };
  const groundAt = (screenY: number) => {
    const yy = (screenY - cy) / scale;
    return focusZ + (yy * pose.distance) / (sin * pose.distance + yy * cos);
  };
  return {
    point,
    groundAt,
    factor,
    scale,
    focus,
    focusZ,
    follow: pose.follow,
    span,
    sin,
    cos,
    cy,
    width,
    height,
  };
}
export type RaceProjection = ReturnType<typeof raceProjection>;
