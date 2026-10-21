import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { Link } from "wouter";
import type { LobbyGame } from "./catalog";
import roundOne from "@/assets/lobby/banners/round-one.png";
import megaFireBlaze from "@/assets/lobby/banners/mega-fire-blaze.png";
import redDoor from "@/assets/lobby/banners/red-door-roulette.png";
import { POKER_ART } from "@/components/poker/artwork";
import { POKER_GAMES } from "@workspace/api-zod/poker";
import arcadeRoulette from "@/assets/lobby/banners/arcade-roulette.png";
import "./photo-banner-slider.css";

interface Banner {
  image: string;
  title: string;
  subtitle: string;
  color: string;
  alt: string;
  gameId?: string;
  launchUrl?: string;
  artworkHasTitle?: boolean;
}

const BANNERS: Banner[] = [
  ...POKER_GAMES.map(code => ({ image: POKER_ART[code].src, title: POKER_ART[code].title, subtitle: "20-second betting · " + POKER_ART[code].subtitle, color: POKER_ART[code].accent, alt: POKER_ART[code].title + " casino poster", gameId: code, artworkHasTitle: true })),
  { image: roundOne, title: "Round One", subtitle: "The casino collection", color: "#eacb82", alt: "Round One casino banner with a golden vault and a roulette host", gameId: "roulette" },
  { image: megaFireBlaze, title: "Mega Fire Blaze", subtitle: "Roulette Live", color: "#f5a5f3", alt: "Mega Fire Blaze Roulette Live banner with a host and a red roulette table", gameId: "roulette" },
  { image: redDoor, title: "Red Door Roulette", subtitle: "Behind the red door", color: "#f5cd94", alt: "Red Door Roulette Live banner with a host, red door and golden roulette table", gameId: "roulette" },
  { image: arcadeRoulette, title: "Arcade Roulette", subtitle: "Take your seat at the wheel", color: "#eecb84", alt: "Arcade Roulette banner with a golden roulette wheel and numbered balls", gameId: "roulette" },
];

function BannerPlayButton({ banner, games, active, mobile = false }: { banner: Banner; games: LobbyGame[]; active: boolean; mobile?: boolean }) {
  const game = games.find((item) => item.id === banner.gameId);
  const href = banner.launchUrl ?? game?.route;
  const name = game?.name ?? "Poker";
  const className = `photo-banners-play${mobile ? " photo-banners-play-mobile" : ""}`;
  const label = `Play ${name} from ${banner.title}`;
  const content = <><Play size={15} fill="currentColor" aria-hidden="true" /><span>Play {name}</span><ArrowRight size={15} aria-hidden="true" /></>;
  if (!href || (!banner.launchUrl && !game?.enabled)) {
    return <button type="button" className={className} disabled aria-label={`${name} currently unavailable`} title="Currently unavailable">{content}</button>;
  }
  if (banner.launchUrl) {
    return <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} tabIndex={active ? 0 : -1}>{content}</a>;
  }
  return <Link className={className} href={href} aria-label={label} tabIndex={active ? 0 : -1}>{content}</Link>;
}

export function PhotoBannerSlider({ games }: { games: LobbyGame[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [viewport, api] = useEmblaCarousel({ loop: true, duration: reducedMotion ? 0 : 30 });
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(reducedMotion);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const autoplay = !paused && !hovered && visible && pageVisible;

  useEffect(() => {
    if (!api) return;
    const select = () => setSelected(api.selectedScrollSnap());
    const stop = () => setPaused(true);
    select();
    api.on("select", select).on("reInit", select).on("pointerDown", stop);
    return () => { api.off("select", select).off("reInit", select).off("pointerDown", stop); };
  }, [api]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => { setReducedMotion(media.matches); if (media.matches) setPaused(true); };
    const visibilityChanged = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    if (root.current) observer.observe(root.current);
    media.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  useEffect(() => {
    if (!api || !autoplay) return;
    const timer = window.setTimeout(() => api.scrollNext(), 6000);
    return () => window.clearTimeout(timer);
  }, [api, autoplay, selected]);

  function show(index: number) {
    setPaused(true);
    api?.scrollTo(index, reducedMotion);
  }

  return (
    <div
      className="photo-banners"
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label="Casino photo banners"
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!(event.target as HTMLElement).closest("[data-banner-autoplay]")) setPaused(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        show((selected + (event.key === "ArrowLeft" ? -1 : 1) + BANNERS.length) % BANNERS.length);
      }}
    >
      <div className="photo-banners-frame">
        <div className="photo-banners-viewport" ref={viewport}>
          <div className="photo-banners-track">
            {BANNERS.map((banner, index) => (
              <div className={`photo-banners-slide${banner.artworkHasTitle ? " photo-banners-titled" : ""}`} key={banner.title} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${BANNERS.length}: ${banner.title}`} aria-hidden={selected !== index} inert={selected !== index}>
                <img src={banner.image} alt={banner.alt} width={1200} height={384} loading="lazy" decoding="async" draggable={false} />
                <div className="photo-banners-copy">
                  {!banner.artworkHasTitle && <>
                    <span style={{ color: banner.color }}>THE LUNAR COLLECTION</span>
                    <strong>{banner.title}</strong>
                    <p>{banner.subtitle}</p>
                  </>}
                  <BannerPlayButton banner={banner} games={games} active={selected === index} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="photo-banners-dots" aria-label="Choose a banner">
          {BANNERS.map((banner, index) => (
            <button key={banner.title} type="button" aria-label={`Go to banner ${index + 1}: ${banner.title}`} aria-current={selected === index ? "true" : undefined} onClick={() => show(index)}><span /></button>
          ))}
        </div>
      </div>
      <div className="photo-banners-toolbar">
        <div className="photo-banners-caption" aria-live={autoplay ? "off" : "polite"} aria-atomic="true">
          <span>{String(selected + 1).padStart(2, "0")} <i>/ {String(BANNERS.length).padStart(2, "0")}</i></span>
          <strong>{BANNERS[selected].title}</strong>
        </div>
        <div className="photo-banners-controls">
          <button type="button" aria-label="Previous banner" onClick={() => show((selected - 1 + BANNERS.length) % BANNERS.length)}><ArrowLeft size={17} /></button>
          <button type="button" data-banner-autoplay aria-label={paused ? "Play banner slideshow" : "Pause banner slideshow"} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
          <button type="button" aria-label="Next banner" onClick={() => show((selected + 1) % BANNERS.length)}><ArrowRight size={17} /></button>
        </div>
        <BannerPlayButton banner={BANNERS[selected]} games={games} active mobile />
      </div>
      <div className="photo-banners-thumbnails" aria-label="Banner previews">
        {BANNERS.map((banner, index) => (
          <button type="button" key={banner.title} aria-label={`Show ${banner.title}`} aria-pressed={selected === index} onClick={() => show(index)}>
            <img src={banner.image} alt="" width={1200} height={384} loading="lazy" decoding="async" draggable={false} />
            <span>{banner.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
