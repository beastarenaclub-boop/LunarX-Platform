import type { Settings } from "@/game/store";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio } from "@/game/audio";
import { useDialogSound } from "@/game/useDialogSound";
import { t } from "@/game/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings as SettingsIcon, Lock } from "lucide-react";
import { LEVEL_REWARDS } from "@/game/progression";

const PLANES: { id: Settings["planeSkin"]; label: string }[] = [
  { id: "classic", label: "Classic Rocket 🚀" },
  { id: "jet", label: "Shuttle 🛰️" },
  { id: "rocket", label: "Saturn V 🚀" },
  { id: "ufo", label: "UFO 🛸" },
  { id: "paper", label: "Satellite 📡" },
];

const TRAILS = ["#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];

const THEMES: { id: Settings["theme"]; label: string; swatch: string }[] = [
  { id: "default", label: "Crimson", swatch: "linear-gradient(135deg, #1a1326, #350a1d)" },
  { id: "neon", label: "Neon", swatch: "linear-gradient(135deg, #1a0033, #330033)" },
  { id: "midnight", label: "Midnight", swatch: "linear-gradient(135deg, #050a1a, #0a1a33)" },
  { id: "sunset", label: "Sunset", swatch: "linear-gradient(135deg, #1a0a05, #33180a)" },
];

const QUALITY_VALUES: readonly Settings["quality"][] = ["low", "medium", "high"] as const;
const LANG_VALUES: readonly Settings["language"][] = ["en", "hi"] as const;
const PLANE_VALUES: readonly Settings["planeSkin"][] = ["classic", "jet", "rocket", "ufo", "paper"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const settings = useStore((s) => s.settings);
  const unlockedSkins = useStore((s) => s.progression.unlockedSkins);
  const unlockedTrails = useStore((s) => s.progression.unlockedTrails);
  const lang = settings.language;
  useDialogSound(open);

  const skinUnlockLevel = (id: Settings["planeSkin"]): number | null => {
    const r = LEVEL_REWARDS.find((r) => r.kind === "skin" && r.value === id);
    return r ? r.level : null;
  };
  const trailUnlockLevel = (color: string): number | null => {
    const r = LEVEL_REWARDS.find((r) => r.kind === "trail" && r.value === color);
    return r ? r.level : null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4" />
            {t(lang, "settings")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Theme */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "theme")}
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {THEMES.map((th) => (
                <button
                  key={th.id}
                  onClick={() => updateSettings({ theme: th.id })}
                  className={`rounded-lg p-1 border-2 transition ${
                    settings.theme === th.id ? "border-primary" : "border-transparent"
                  }`}
                >
                  <div
                    className="h-12 rounded-md border border-border"
                    style={{ background: th.swatch }}
                  />
                  <div className="text-[10px] mt-1 text-muted-foreground">{th.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Plane skin */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "plane")}
            </Label>
            <Select
              value={settings.planeSkin}
              onValueChange={(v) => {
                if (
                  (PLANE_VALUES as readonly string[]).includes(v) &&
                  unlockedSkins.includes(v as Settings["planeSkin"])
                ) {
                  updateSettings({ planeSkin: v as Settings["planeSkin"] });
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLANES.map((p) => {
                  const locked = !unlockedSkins.includes(p.id);
                  const lvl = skinUnlockLevel(p.id);
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={locked}>
                      <span className="flex items-center gap-2">
                        {p.label}
                        {locked && (
                          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Lv {lvl ?? "?"}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Trail color */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "trail")}
            </Label>
            <div className="flex gap-2 flex-wrap">
              {TRAILS.map((c) => {
                const locked = !unlockedTrails.includes(c);
                const lvl = trailUnlockLevel(c);
                return (
                  <button
                    key={c}
                    onClick={() => {
                      if (!locked) updateSettings({ trailColor: c });
                    }}
                    disabled={locked}
                    title={locked ? `Unlocks at Level ${lvl ?? "?"}` : ""}
                    className={`relative w-9 h-9 rounded-full border-2 transition ${
                      settings.trailColor === c && !locked
                        ? "border-foreground scale-110"
                        : "border-transparent"
                    } ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
                    style={{ background: c }}
                  >
                    {locked && (
                      <Lock className="w-3 h-3 absolute inset-0 m-auto text-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sound */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t(lang, "sound")}</Label>
              <Switch
                checked={settings.sound}
                onCheckedChange={(c) => {
                  // Unlock the AudioContext FIRST so updateSettings →
                  // settingsApplyVolumes can immediately apply the slider
                  // values; otherwise the very first sound-on after page
                  // load needs a slider nudge to produce audible output.
                  unlockAudio();
                  updateSettings({ sound: c });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t(lang, "masterVolume")} ({Math.round(settings.masterVolume * 100)}%)</Label>
              <Slider
                value={[settings.masterVolume * 100]}
                onValueChange={([v]) => updateSettings({ masterVolume: v / 100 })}
                max={100}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t(lang, "sfxVolume")} ({Math.round(settings.sfxVolume * 100)}%)</Label>
              <Slider
                value={[settings.sfxVolume * 100]}
                onValueChange={([v]) => updateSettings({ sfxVolume: v / 100 })}
                max={100}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t(lang, "uiVolume")} ({Math.round(settings.uiVolume * 100)}%)</Label>
              <Slider
                data-testid="slider-ui-volume"
                value={[settings.uiVolume * 100]}
                onValueChange={([v]) => updateSettings({ uiVolume: v / 100 })}
                max={100}
              />
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "quality")}
            </Label>
            <Select
              value={settings.quality}
              onValueChange={(v) => {
                if ((QUALITY_VALUES as readonly string[]).includes(v)) {
                  updateSettings({ quality: v as Settings["quality"] });
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "language")}
            </Label>
            <Select
              value={settings.language}
              onValueChange={(v) => {
                if ((LANG_VALUES as readonly string[]).includes(v)) {
                  updateSettings({ language: v as Settings["language"] });
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">हिन्दी</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Turbo */}
          <div className="flex items-center justify-between">
            <div>
              <Label>{t(lang, "turbo")}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Faster rounds (~2.5s betting)</p>
            </div>
            <Switch
              checked={settings.turbo}
              onCheckedChange={(c) => updateSettings({ turbo: c })}
            />
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
