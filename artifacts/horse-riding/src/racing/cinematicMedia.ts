import { venueById, type CameraMode } from "./engine";

const root = `${import.meta.env.BASE_URL}assets/racing/higgsfield/`;
export const venuePhoto = (id: string) => `${root}${venueById(id).id}.jpg`;
export const horsePhoto = (id: number) =>
  `${root}runner-${Math.max(1, Math.min(8, id))}.jpg`;
export const venueFilm = (id: string, quality: "high" | "low") =>
  `${root}${venueById(id).id}-${quality === "high" ? "1080" : "720"}.mp4`;
export const CINEMA_SHOTS: Record<CameraMode, { start: number; end: number }> =
  {
    broadcast: { start: 0.15, end: 2.85 },
    rail: { start: 3.15, end: 5.85 },
    drone: { start: 6.15, end: 8.85 },
    chase: { start: 9.15, end: 11.85 },
    jockey: { start: 12.15, end: 14.85 },
    finish: { start: 15.15, end: 17.8 },
  };

export function cameraAtFilmTime(time: number): CameraMode {
  return (
    ["broadcast", "rail", "drone", "chase", "jockey", "finish"] as CameraMode[]
  )[Math.min(5, Math.floor(Math.max(0, time) / 3))];
}
