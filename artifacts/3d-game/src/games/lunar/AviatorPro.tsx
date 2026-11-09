import { useEffect, useState } from "react";
import { RtpDisclosure } from "@/components/RtpDisclosure";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { initEngine, setActiveCrashGame } from "@/game/engine";
import RealtimeBridge from "@/components/lunar/RealtimeBridge";
import CrashWinReceipt from "@/components/CrashWinReceipt";

import AvHeader from "@/games/lunar/AvHeader";
import AvHistoryStrip from "@/games/lunar/AvHistoryStrip";
import AvCanvas from "@/games/lunar/AvCanvas";
import AvSidePanel from "@/games/lunar/AvSidePanel";
import AvBetPanel from "@/games/lunar/AvBetPanel";
import AvChat from "@/games/lunar/AvChat";
import SettingsDialog from "@/components/lunar/SettingsDialog";
import StatsDialog from "@/components/lunar/StatsDialog";
import ProvablyFairDialog from "@/components/lunar/ProvablyFairDialog";
import AchievementsDialog from "@/components/lunar/AchievementsDialog";

import { cn } from "@/lib/utils";

// Operator-shell icons, lifted from the reference's own markup rather than
// approximated with a lucide equivalent — the star in particular is a compound
// outline that no icon-set glyph matches. `currentColor` so the buttons can
// carry hover/active state.
const ICON = "h-6 w-6 shrink-0";

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" aria-hidden="true">
      <path
        d="M14.1318 4.3191C14.5077 3.91468 15.1403 3.89163 15.5449 4.26734C15.9493 4.64318 15.9724 5.27582 15.5967 5.68043L9.72852 11.9998L15.5967 18.3191C15.9724 18.7237 15.9493 19.3563 15.5449 19.7322C15.1403 20.1079 14.5077 20.0849 14.1318 19.6804L7 11.9998L14.1318 4.3191Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={ICON} aria-hidden="true">
      <path
        d="M12.1 5.43L14.12 9.84L18.8 10.38L15.29 13.57L16.22 18.29L12.09 15.92L7.96 18.29L8.89 13.57L5.38 10.38L10.06 9.84L12.1 5.43ZM12.1 2.5C11.62 2.5 11.15 2.7 10.91 3.21C10.37 4.4 8.73 7.98 8.73 7.98C8.73 7.98 4.93 8.41 3.66 8.56C2.94 8.64 2.5 9.25 2.5 9.87C2.5 10.21 2.63 10.56 2.93 10.83C3.88 11.69 6.72 14.28 6.72 14.28L5.72 19.38C5.56 20.18 5.95 21 6.9 21C7.11 21 7.44 20.9 7.65 20.77C8.76 20.13 12.1 18.21 12.1 18.21C12.1 18.21 15.44 20.13 16.55 20.77C16.76 20.89 17.09 21 17.3 21C18.24 21 18.63 20.16 18.48 19.38C18.03 17.11 17.48 14.28 17.48 14.28C17.48 14.28 20.32 11.69 21.27 10.83C21.57 10.56 21.7 10.21 21.7 9.87C21.7 9.25 21.26 8.64 20.54 8.56C19.27 8.42 15.47 7.98 15.47 7.98C15.47 7.98 14.26 5.33 13.29 3.21C13.06 2.7 12.58 2.5 12.1 2.5Z"
        fill={filled ? "#f5b120" : "currentColor"}
      />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} aria-hidden="true">
      <path
        d="M8 21C7.45 21 7 20.55 7 20V17H4C3.45 17 3 16.55 3 16C3 15.45 3.45 15 4 15H9V20C9 20.55 8.55 21 8 21ZM17 20V17H20C20.55 17 21 16.55 21 16C21 15.45 20.55 15 20 15H15V20C15 20.55 15.45 21 16 21C16.55 21 17 20.55 17 20ZM21 8C21 7.45 20.55 7 20 7H17V4C17 3.45 16.55 3 16 3C15.45 3 15 3.45 15 4V9H20C20.55 9 21 8.55 21 8ZM9 9V4C9 3.45 8.55 3 8 3C7.45 3 7 3.45 7 4V7H4C3.45 7 3 7.45 3 8C3 8.55 3.45 9 4 9H9Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Casino chrome above the game — back arrow left, centered title, favourite and
 * fullscreen right. Operator shell rather than part of the Spribe game, so it
 * sits above the 40px game header and is excluded from the layout comparison.
 *
 * The 56px height is load-bearing: the mobile stage formula further down
 * subtracts it, so the two must move together.
 */
function ChromeBar({ onBack }: { onBack: () => void }) {
  const [faved, setFaved] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    // #151515 operator bar, a shade darker than the game's #1b1c1d header, with
    // a 1px page-coloured seam between the two.
    <div className="relative flex h-[56px] shrink-0 items-center justify-between border-b border-[#0e0e0e] bg-[#151515] px-4">
      <button
        onClick={onBack}
        className="p-2 text-[#ffffffcc] transition-colors hover:text-white"
        aria-label="Back to lobby"
        data-testid="btn-chrome-back"
      >
        {/* Same 24px box as the pair on the right — it reads larger because the
            chevron glyph spans almost the full height. */}
        <BackIcon />
      </button>

      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[16px] text-[#FFFFFFCC]">
        Aviator
      </span>

      <div className="flex items-center gap-7">
        <button
          onClick={() => setFaved((v) => !v)}
          className={cn(
            "pr-2 text-[#ffffff40] transition-colors",
            !faved && "hover:text-[#ffffffcc]",
          )}
          aria-label="Favourite"
          aria-pressed={faved}
          data-testid="btn-chrome-fav"
        >
          <StarIcon filled={faved} />
        </button>
        <button
          onClick={toggleFullscreen}
          className="pr-2 text-[#ffffffcc] transition-colors hover:text-white"
          aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
          data-testid="btn-chrome-fullscreen"
        >
          <FullscreenIcon />
        </button>
      </div>
    </div>
  );
}

/**
 * Spribe-exact Aviator skin. The layout contract below was read out of the live
 * reference build (aviator-demo.spribegaming.com) rather than inferred from
 * screenshots — every number here is a computed style from that DOM:
 *
 *   tokens      paddingSmall/marginSmall 4px · header 40px · history 32px
 *   breakpoints Bootstrap 5 — 576 / 768 / 992 / 1200 / 1400 (NOT Tailwind's)
 *   columns     .bets-widget-container is 320 / 370 / 410px at 992 / 1200 / 1400
 *               .game-play fills the rest, padding-left 4px
 *   chat        a 360px fixed drawer on the right; the page shrinks by 360 when
 *               it is open, and it goes full-width below 768
 *   under 992   .game-container flips to column-reverse and the page scrolls:
 *               stage first, bet controls, then the bets list at 80vh
 *   mobile stage  calc(100dvh - 496px), min 200px — 496 is the reference's
 *               --stageBoardOffset (header+history+controls+list header chrome)
 *
 * The reference never scales the UI up on wide screens: it is a fluid layout
 * with fixed-px chrome, so a 4K panel shows more canvas, not bigger buttons.
 *
 * Bound to gameCode "lunar" so it uses the shipped game's wallet scope, RTP
 * config and round stream. Flip to "aviator" once that gameCode's server config
 * is enabled and funded.
 */
export default function AviatorPro({
  gameCode = "lunar",
  // Rendered inside a partner's iframe. The partner owns the surrounding page,
  // so everything that belongs to OUR shell — the operator bar, the platform
  // nav, the social chat drawer, and every redirect out of the game — is
  // suppressed. Driven by a prop rather than the .launcher-mode stylesheet
  // because props are type-checked and CSS is not (three of that rule's four
  // selectors match nothing at all).
  embedded = false,
}: { gameCode?: string; embedded?: boolean }) {
  const multiplier = useStore((s) => s.multiplier);
  const { user, isLoading } = useAuth();
  const houseEdge = useStore((s) => s.roundHouseEdge);

  // Live-player beacon, keyed on THIS page's game code — not a literal.
  // `/aviator-fun` renders this same component with gameCode "aviator-fun",
  // so the play-money demo reports on its own code and can never be counted
  // as a live player on the real-money lunar game. `presence:aviator-fun` is
  // not in the topic ACL today, so the demo simply gets refused — the safe
  // direction: it counts nowhere rather than counting as lunar.

  const [, navigate] = useLocation();

  // Chat is a right-hand drawer that steals width from the page on desktop and
  // covers it below 768 — so don't open it on load on a phone.
  // Embedded: never open. The drawer is 353px of a partner's frame, it is a
  // platform-wide social feature rather than part of the game, and every
  // responsive breakpoint below measures the viewport — which stops matching
  // the real content width the moment the drawer takes a third of it.
  const [chatOpen, setChatOpen] = useState(
    () => !embedded && (typeof window === "undefined" || window.innerWidth >= 992),
  );
  const [twoPanels, setTwoPanels] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  // The demo game's crash point comes from a bank-targeting engine, so there is
  // no seed commitment behind it. Every fairness affordance is withheld rather
  // than shown pointing at a proof that cannot hold.
  const openFair = () => setFairOpen(true);
  const [achOpen, setAchOpen] = useState(false);

  // Standalone, a signed-out visitor belongs on the lobby. Embedded, this same
  // navigation would swap the partner's game frame for our login page — and it
  // fires on any transient /auth/me 401, which is realistic here because the
  // launcher session rides a partitioned third-party cookie.
  useEffect(() => {
    if (!embedded && !isLoading && !user) navigate("/");
  }, [embedded, isLoading, user, navigate]);

  useEffect(() => {
    if (!embedded || !user) return;
    setActiveCrashGame(gameCode);
    return initEngine();
  }, [gameCode, embedded, user?.id]);

  useEffect(() => {
    document.title = `${multiplier.toFixed(2)}x • Aviator`;
  }, [multiplier]);

  if (!user) {
    // A bare `null` inside an iframe is an unexplained black rectangle. Say
    // what is happening; the session usually returns on the next poll.
    if (embedded) {
      return (
        <div className="flex h-[100dvh] items-center justify-center bg-[#0e0e0e] text-sm text-white/60">
          Reconnecting…
        </div>
      );
    }
    return null;
  }

  return (
    // Roboto is Spribe's face. Scoped to this subtree so the lobby, wallet and
    // admin keep the app's Inter.
    <div
      data-game-screen="lunar"
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0e0e0e] text-white"
      data-testid="aviator-game"
      style={{ height: embedded ? '100dvh' : 'var(--fit-height, 100dvh)', fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' }}
    >
      {embedded && <RealtimeBridge />}
      <CrashWinReceipt key={gameCode} game={gameCode} userId={user.id} />
      {!embedded && <ChromeBar onBack={() => navigate("/")} />}

      {/* .main-container — width: calc(100% - 360px) while the chat drawer is open */}
      <div
        className={cn(
          // Scrollbar hidden like the reference's body.scroll-hide — a classic
          // scrollbar would eat 15px off the game column below 992.
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // Must stay in step with the chat drawer's width below, or the page
          // and the drawer overlap.
          chatOpen ? "w-full min-[768px]:w-[calc(100%-353px)]" : "w-full",
        )}
      >
        <AvHeader
          embedded={embedded}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStats={() => setStatsOpen(true)}
          onOpenFair={openFair}
          onOpenAchievements={() => setAchOpen(true)}
        />

        {/* .game-container — flex row at >=992, column-reverse below it */}
        <div className="flex min-h-0 flex-none flex-col-reverse p-[4px] min-[992px]:flex-1 min-[992px]:flex-row">
          {/* .bets-widget-container */}
          <aside className="h-[80vh] w-full shrink-0 min-[992px]:h-full min-[992px]:w-[320px] min-[1200px]:w-[370px] min-[1400px]:w-[410px]">
            <AvSidePanel onOpenFair={openFair} />
          </aside>

          {/* .game-play */}
          <div className="flex w-full min-w-0 flex-col pb-[4px] min-[992px]:h-full min-[992px]:w-[calc(100%-320px)] min-[992px]:pb-0 min-[992px]:pl-[4px] min-[1200px]:w-[calc(100%-370px)] min-[1400px]:w-[calc(100%-410px)]">
            <div className="mb-[4px] h-[32px] shrink-0">
              <AvHistoryStrip />
            </div>

            {/* .stage-board */}
            {/* 496px is the reference's --stageBoardOffset; +56 for our chrome
                bar. Keep this in step with ChromeBar's height above. */}
            <div
              className={cn(
                // 496 is the reference's --stageBoardOffset; the standalone
                // page adds ChromeBar's 56. Both must move together.
                embedded ? "h-[calc(100dvh-496px)]" : "h-[calc(100dvh-552px)]",
                "min-h-[200px] min-[992px]:h-full min-[992px]:min-h-0 min-[992px]:flex-1",
              )}
            >
              <AvCanvas />
            </div>

            {/* .bet-controls — the panels wrap on container width, not on a
                breakpoint: each has a 310px basis, so they sit side by side
                while both fit and stack the moment they don't. */}
            <div className="flex shrink-0 flex-wrap justify-center gap-[4px] pt-[4px]">
              <AvBetPanel
                panelIdx={0}
                onAdd={twoPanels ? undefined : () => setTwoPanels(true)}
              />
              {twoPanels && <AvBetPanel panelIdx={1} onRemove={() => setTwoPanels(false)} />}
            </div>
          </div>
        </div>
      </div>

      {/* .chat-bar — 360px on the right, full-width below 768 */}
      {chatOpen && (
        // Starts below the 56px chrome bar, not inset-y-0 — the operator bar
        // spans the full width above the chat in the reference, and a
        // full-height drawer buries its favourite/fullscreen buttons.
        // z-40 keeps the drawer over the page but under the z-50 overlay layer.
        <div
          className={cn(
            "absolute bottom-0 right-0 z-40 w-full min-[768px]:w-[353px]",
            embedded ? "top-0" : "top-[56px]",
          )}
        >
          <AvChat onClose={() => setChatOpen(false)} />
        </div>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
      <ProvablyFairDialog open={fairOpen} onOpenChange={setFairOpen} terms={<RtpDisclosure houseEdge={houseEdge} label="This round" inRules />} />
      <AchievementsDialog open={achOpen} onOpenChange={setAchOpen} />

    </div>
  );
}
