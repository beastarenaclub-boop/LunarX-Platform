"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { entryAudio } from "./entry-audio";

// Root-layout ownership keeps one audio context alive across entry and login routes.
export default function EntryAudioLifecycle() {
  const pathname = usePathname();
  useEffect(() => {
    const access =
      /^\/(?:login|signup|member\/(?:login|signup)|(?:admin|agent)\/login)\/?$/.test(
        pathname || "",
      );
    entryAudio.setScene(
      pathname === "/" ? "entrance" : access ? "login" : null,
    );
  }, [pathname]);
  useEffect(() => {
    const activate = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".entry-sound-toggle")
      )
        return;
      void entryAudio.activate();
    };
    document.addEventListener("pointerdown", activate);
    document.addEventListener("keydown", activate);
    document.addEventListener("visibilitychange", entryAudio.visibility);
    window.addEventListener("focus", entryAudio.visibility);
    window.addEventListener("pageshow", entryAudio.visibility);
    window.addEventListener("pagehide", entryAudio.suspend);
    return () => {
      document.removeEventListener("pointerdown", activate);
      document.removeEventListener("keydown", activate);
      document.removeEventListener("visibilitychange", entryAudio.visibility);
      window.removeEventListener("focus", entryAudio.visibility);
      window.removeEventListener("pageshow", entryAudio.visibility);
      window.removeEventListener("pagehide", entryAudio.suspend);
      entryAudio.setScene(null);
    };
  }, []);
  return null;
}
