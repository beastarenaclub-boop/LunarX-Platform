import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio } from "@/game/audio";
import { t } from "@/game/i18n";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";
import { getCrashTheme } from "@/game/crashThemes";

export default function Onboarding() {
  const onboarded = useStore((s) => s.settings.onboarded);
  const lang = useStore((s) => s.settings.language);
  const gameCode = useStore((s) => s.activeGameCode);
  const theme = getCrashTheme(gameCode);
  const title = theme?.name ?? t(lang, "appTitle");
  const Icon = theme?.Icon ?? Rocket;
  const description = theme
    ? lang === "hi"
      ? "राउंड शुरू होने से पहले बेट लगाएँ। मल्टीप्लायर बढ़ते समय, राउंड खत्म होने से पहले कैश आउट करें।"
      : "Place your bet before the round starts. Watch the multiplier rise and cash out before the round ends."
    : t(lang, "onboarding");

  return (
    <Dialog open={!onboarded} onOpenChange={() => {}}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="flex flex-col items-center text-center pt-2 pb-3">
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-3 glow-primary">
            <Icon className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground mt-2 px-2">
            {description}
          </p>
          <Button
            className="mt-5 w-full"
            onClick={() => {
              updateSettings({ onboarded: true });
              unlockAudio();
            }}
          >
            {t(lang, "gotIt")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
