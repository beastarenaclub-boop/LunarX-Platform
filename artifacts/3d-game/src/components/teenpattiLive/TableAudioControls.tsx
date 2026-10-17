import { Music2, Volume2, VolumeX, AudioLines } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { useTeenPattiAudio } from "./useTeenPattiAudio";
import { TableSoundSettings } from "@/components/table/TableSoundSettings";

export default function TableAudioControls({
  audio,
}: {
  audio: ReturnType<typeof useTeenPattiAudio>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <audio
        ref={audio.element}
        src={audio.musicUrl}
        loop
        preload="none"
        data-testid="tpl-music"
        onPlaying={() => audio.setMusicPlaying(true)}
        onPause={() => audio.setMusicPlaying(false)}
        onError={() => audio.setMusicPlaying(false)}
      />
      <audio
        ref={audio.ambienceElement}
        src={audio.ambienceUrl}
        loop
        preload="none"
        data-testid="tpl-ambience"
      />
      <button type="button" onClick={() => setOpen(true)} data-testid="tpl-audio-settings"
        aria-label="Audio settings" aria-haspopup="dialog" aria-expanded={open}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-amber-100/80 hover:bg-white/10">
        {audio.sound && audio.unlocked ? <Volume2 size={20} /> : <VolumeX size={20} />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm border-amber-200/20 bg-[#101c18] text-white" data-testid="tpl-audio-controls">
          <DialogTitle>Table audio</DialogTitle>
          <DialogDescription className="text-white/60">Control game sounds, casino ambience and music.</DialogDescription>
          <div className="tpl-audio-settings-grid">
      <button
        type="button"
        data-testid="tpl-sound-toggle"
        onClick={audio.toggleSound}
        aria-pressed={audio.sound && audio.unlocked}
      >
        {audio.sound && audio.unlocked ? (
          <Volume2 size={15} />
        ) : (
          <VolumeX size={15} />
        )}
        {audio.sound && audio.unlocked ? "Sound on" : "Enable sound"}
      </button>
      <button
        type="button"
        data-testid="tpl-ambience-toggle"
        onClick={audio.toggleAmbience}
        aria-pressed={audio.ambience}
        aria-label={`Casino ambience ${audio.ambience ? "on" : "off"}`}
      >
        <AudioLines size={14} /> Casino {audio.ambience ? "on" : "off"}
      </button>
      <button
        type="button"
        data-testid="tpl-music-toggle"
        onClick={audio.toggleMusic}
        aria-pressed={audio.music}
      >
        <Music2 size={14} /> Music {audio.music ? "on" : "off"}
      </button>
      <label className="flex flex-col gap-3 text-sm">Music volume
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={Math.round(audio.volume * 100)}
        aria-label="Table music volume"
        onChange={(e) => audio.setVolume(Number(e.target.value) / 100)}
      />
      </label>
      <span
        className="tpl-audio-playing"
        data-playing={audio.musicPlaying}
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
        <i />
      </span>
          </div>
          <TableSoundSettings />
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg bg-amber-200 font-bold text-[#101c18]">Done</button>
        </DialogContent>
      </Dialog>
    </>
  );
}
