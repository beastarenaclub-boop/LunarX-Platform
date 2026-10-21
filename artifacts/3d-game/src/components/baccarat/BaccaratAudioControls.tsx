import { useState } from "react";
import { Music2, Volume2, VolumeX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableSoundSettings } from "@/components/table/TableSoundSettings";
import { updateSettings } from "@/game/engine";
import type { useBaccaratAudio } from "./useBaccaratAudio";

export default function BaccaratAudioControls({
  audio,
}: {
  audio: ReturnType<typeof useBaccaratAudio>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <audio
        ref={audio.element}
        src={audio.musicUrl}
        loop
        preload="auto"
        data-testid="baccarat-music"
        onPlaying={() => audio.setMusicPlaying(true)}
        onPause={() => audio.setMusicPlaying(false)}
        onError={() => audio.setMusicPlaying(false)}
      />
      <button
        className="bc-icon"
        aria-label="Audio settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="baccarat-audio-settings"
        onClick={() => setOpen(true)}
      >
        {audio.settings.sound && !audio.needsTap ? (
          <Volume2 size={17} />
        ) : (
          <VolumeX size={17} />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="bc-audio-dialog"
          data-testid="baccarat-audio-controls"
        >
          <DialogTitle>Baccarat VIP audio</DialogTitle>
          <DialogDescription>
            Adjust lounge music and card / chip sounds.
          </DialogDescription>
          <div className="bc-audio-options">
            <button
              onClick={audio.toggleSound}
              aria-pressed={audio.settings.sound}
              data-testid="baccarat-sound-toggle"
            >
              <Volume2 size={17} />{" "}
              {audio.settings.sound && !audio.needsTap
                ? "Sound on"
                : "Enable sound"}
            </button>
            <button
              onClick={() => {
                audio.activate();
                updateSettings({ music: !audio.settings.music });
              }}
              aria-pressed={audio.settings.music}
              data-testid="baccarat-music-toggle"
            >
              <Music2 size={17} /> Music {audio.settings.music ? "on" : "off"}
            </button>
            <label>
              Music volume · {Math.round(audio.settings.musicVolume * 100)}%
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label="Music volume"
                value={Math.round(audio.settings.musicVolume * 100)}
                onChange={(e) =>
                  updateSettings({ musicVolume: Number(e.target.value) / 100 })
                }
              />
            </label>
          </div>
          <TableSoundSettings />
          {audio.audioState === "unsupported" && (
            <p>
              Audio is unavailable in this browser. The table is still
              connected.
            </p>
          )}
          <button className="bc-audio-done" onClick={() => setOpen(false)}>
            Done
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
