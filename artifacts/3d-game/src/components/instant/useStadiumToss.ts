import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Plays one physical toss per explicit bet. Media can never hold a receipt hostage. */
export function useStadiumToss(busy: boolean, motion: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const wasBusy = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const finish = useCallback(() => {
    generation.current++;
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    video.current?.pause();
    setPlaying(false);
  }, []);

  useLayoutEffect(() => {
    const started = busy && !wasBusy.current;
    wasBusy.current = busy;
    if (!started || !motion || disabled || failed || document.hidden) return;
    const el = video.current;
    if (!el) return;
    const attempt = ++generation.current;
    setProgress(0);
    setPlaying(true);
    el.currentTime = 0;
    watchdog.current = setTimeout(finish, 13000);
    void el.play().catch(() => {
      if (attempt === generation.current) finish();
    });
  }, [busy, motion, disabled, failed, finish]);

  useEffect(() => {
    if (!motion || disabled || failed) finish();
  }, [motion, disabled, failed, finish]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      generation.current++;
      if (watchdog.current) clearTimeout(watchdog.current);
      video.current?.pause();
    };
  }, [finish]);

  return {
    video,
    playing,
    disabled,
    failed,
    progress,
    finish,
    toggle: () => setDisabled((value) => !value),
    onError: () => {
      setFailed(true);
      finish();
    },
    onTimeUpdate: () => {
      const el = video.current;
      if (el && Number.isFinite(el.duration) && el.duration > 0)
        setProgress(Math.min(1, el.currentTime / el.duration));
    },
  };
}
