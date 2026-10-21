import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize, ZoomIn, ZoomOut } from "lucide-react";

type View = "wide" | "dealer" | "cards";
const VIEWS: { id: View; label: string; zoom: number; origin: string }[] = [
  { id: "wide", label: "Wide", zoom: 1, origin: "50% 50%" },
  { id: "dealer", label: "Dealer", zoom: 1.5, origin: "50% 28%" },
  { id: "cards", label: "Cards", zoom: 2, origin: "50% 100%" },
];

/** Move the footage and server cards as one camera, without remounting audio. */
export function OneDayStudio({ children }: { children: ReactNode }) {
  const player = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("wide");
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [changingScreen, setChangingScreen] = useState(false);
  const enlarged = fullscreen || expanded;
  const origin = VIEWS.find((item) => item.id === view)!.origin;
  const changeZoom = (value: number) =>
    setZoom(Math.max(1, Math.min(2, Math.round(value * 20) / 20)));

  useEffect(() => {
    const sync = () =>
      setFullscreen(document.fullscreenElement === player.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!enlarged) return;
    const oldOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    expandButton.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        setExpanded(false);
        expandButton.current?.focus({ preventScroll: true });
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        player.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        ) ?? [],
      ).filter((node) => node.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.documentElement.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keyboard);
    };
  }, [enlarged, expanded]);

  const toggleScreen = async () => {
    if (changingScreen) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setChangingScreen(true);
    try {
      if (document.fullscreenElement === player.current)
        await document.exitFullscreen();
      else if (player.current?.requestFullscreen)
        await player.current.requestFullscreen();
      else setExpanded(true);
    } catch {
      // Embedded/mobile browsers may not offer the Fullscreen API.
      setExpanded(true);
    } finally {
      setChangingScreen(false);
    }
  };

  return (
    <div
      ref={player}
      className={`od-studio-player ${enlarged ? "od-studio-expanded" : ""}`}
      data-testid="od-studio-player"
      data-expanded={enlarged}
      role={enlarged ? "dialog" : undefined}
      aria-modal={enlarged || undefined}
      aria-label={enlarged ? "Expanded dealer studio" : undefined}
    >
      <div className="od-studio">
        <div
          className="od-studio-camera"
          data-testid="od-studio-camera"
          data-view={view}
          data-zoom={zoom.toFixed(2)}
          style={{ transform: `scale(${zoom})`, transformOrigin: origin }}
        >
          {children}
        </div>
        <div className="od-studio-shade" />
        <div className="od-studio-top">
          <span className="od-studio-tag">
            <i /> IMPERIAL ROOM
          </span>
          <div className="od-studio-audio">
            <span>AI DEALER · HD</span>
          </div>
        </div>
      </div>
      <div className="od-camera-controls" aria-label="Studio camera controls">
        <div className="od-camera-views" role="group" aria-label="Camera view">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`${item.label} camera view`}
              aria-pressed={view === item.id}
              onClick={() => {
                setView(item.id);
                setZoom(item.zoom);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="od-camera-zoom">
          <button
            type="button"
            aria-label="Zoom studio out"
            disabled={zoom <= 1}
            onClick={() => changeZoom(zoom - 0.1)}
          >
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            aria-label="Studio zoom"
            min={1}
            max={2}
            step={0.05}
            value={zoom}
            aria-valuetext={`${Math.round(zoom * 100)} percent`}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <button
            type="button"
            aria-label="Zoom studio in"
            disabled={zoom >= 2}
            onClick={() => changeZoom(zoom + 0.1)}
          >
            <ZoomIn size={16} />
          </button>
          <output aria-label="Current studio zoom">
            {Math.round(zoom * 100)}%
          </output>
        </div>
        <button
          ref={expandButton}
          type="button"
          className="od-camera-fullscreen"
          aria-label={
            enlarged ? "Exit studio fullscreen" : "Open studio fullscreen"
          }
          aria-pressed={enlarged}
          disabled={changingScreen}
          onClick={() => void toggleScreen()}
        >
          {enlarged ? <Minimize size={16} /> : <Maximize size={16} />}
          <span>{enlarged ? "Close" : "Full screen"}</span>
        </button>
      </div>
    </div>
  );
}
