import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio } from "@/game/audio";

/** All tables edit the same persisted sound levels. */
export function TableSoundSettings() {
  const settings = useStore(s => s.settings);
  return <fieldset className="grid gap-3 rounded-xl border border-white/15 p-3" data-testid="table-sound-settings">
    <legend className="px-1 text-sm font-semibold">Game sounds</legend>
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      Sound, coins &amp; win celebration
      <input type="checkbox" className="h-5 w-5 accent-emerald-400" checked={settings.sound}
        onChange={event => { void unlockAudio(); updateSettings({ sound: event.target.checked }); }} />
    </label>
    {([['masterVolume', 'Master volume'], ['sfxVolume', 'Effects & coin volume'], ['uiVolume', 'Button volume']] as const).map(([key, label]) =>
      <label key={key} className="grid gap-2 text-xs">
        <span>{label} · {Math.round(settings[key] * 100)}%</span>
        <input type="range" min="0" max="100" step="5" aria-label={label} value={Math.round(settings[key] * 100)}
          className="w-full accent-emerald-300"
          onChange={event => { void unlockAudio(); updateSettings({ [key]: Number(event.target.value) / 100 }); }} />
      </label>)}
    <p className="text-xs text-white/60">Sound settings apply to every game.</p>
  </fieldset>;
}

