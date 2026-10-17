import { useEffect, useRef } from "react";
import { useStore } from "@/game/store";
import { sfx } from "@/game/audio";

/**
 * Plays a subtle open/close swoosh whenever the given dialog's `open` state
 * transitions. Respects the global Sound toggle (and, via sfxGain, the SFX
 * volume slider). No sound fires on initial mount.
 */
export function useDialogSound(open: boolean) {
  const sound = useStore((s) => s.settings.sound);
  const prev = useRef(open);
  useEffect(() => {
    if (open === prev.current) return;
    const wasOpen = prev.current;
    prev.current = open;
    if (!sound) return;
    if (open && !wasOpen) sfx.dialogOpen();
    else if (!open && wasOpen) sfx.dialogClose();
  }, [open, sound]);
}
