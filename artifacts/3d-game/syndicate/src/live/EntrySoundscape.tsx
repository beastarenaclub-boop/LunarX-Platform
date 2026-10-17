"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { entryAudio, type EntryAudioScene } from "./entry-audio";

export default function EntrySoundscape({
  scene,
  paused = false,
}: {
  scene: EntryAudioScene;
  paused?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const status = useSyncExternalStore(
    entryAudio.subscribe,
    entryAudio.getSnapshot,
    () => "ready",
  );
  useEffect(() => {
    entryAudio.setScene(scene, paused);
    setReady(true);
  }, [scene, paused]);
  const playing = status === "playing";
  const label = playing
    ? "Mute sound"
    : status === "muted"
      ? "Enable sound"
      : status === "unavailable"
        ? "Sound unavailable"
        : "Start sound";
  return (
    <button
      className="entry-sound-toggle"
      type="button"
      aria-label={label}
      aria-pressed={playing}
      disabled={!ready || status === "unavailable"}
      title={label}
      onClick={entryAudio.toggle}
    >
      {playing ? <Volume2 size={16} /> : <VolumeX size={16} />}
      <span>
        {playing
          ? "Sound on"
          : status === "muted"
            ? "Sound off"
            : status === "unavailable"
              ? "No audio"
              : "Tap for sound"}
      </span>
    </button>
  );
}
