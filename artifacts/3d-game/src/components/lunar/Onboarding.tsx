import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio } from "@/game/audio";
import { t } from "@/game/i18n";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";

export default function Onboarding() {
  const onboarded = useStore((s) => s.settings.onboarded);
  const lang = useStore((s) => s.settings.language);

  return (
    <Dialog open={!onboarded} onOpenChange={() => {}}>
      <DialogContent className="max-w-md w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogTitle className="sr-only">{t(lang, "appTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t(lang, "onboarding")}</DialogDescription>
        <div className="flex flex-col items-center text-center pt-2 pb-3">
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-3 glow-primary">
            <Rocket className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold">{t(lang, "appTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-2 px-2">
            {t(lang, "onboarding")}
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
