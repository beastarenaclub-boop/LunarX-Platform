import type { ReactNode } from "react";
import { Link } from "wouter";
import aviatorLogo from "@/assets/aviator-logo.svg";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio, sfx } from "@/game/audio";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { avatarGradient } from "./avUtils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Volume2,
  Music,
  Sparkles,
  Settings as SettingsIcon,
  BarChart3,
  ShieldCheck,
  Trophy,
  Wallet,
  User as UserIcon,
  History as HistoryIcon,
  Gift,
  HelpCircle,
  LogOut,
  Home as HomeIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import {
  useGetWalletBalance,
  useLogout,
  getGetWalletBalanceQueryKey,
  useRealtimeTopic,
  useRealtimeResync,
  disconnectRealtime,
  type GetWalletBalanceGame,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ---- Menu tokens (menu-restyle-report.md) --------------------------------
const MENU_ICON = "h-4 w-4 shrink-0 text-[#9ea0a4]";
const MENU_ROW =
  "flex h-[45px] w-full items-center gap-[13px] px-[14px] text-[14px] font-medium text-white";
const MENU_DIVIDER = "border-b border-[#2a2b2e]";

/** 13px darker band separating groups. */
function MenuSpacer() {
  return <div className="h-[13px] bg-[#141517]" />;
}

/**
 * Action row: icon + label, nothing else. The reference has no chevrons and no
 * accent colours on these.
 */
function MenuRow({
  icon,
  label,
  href,
  onClick,
  testId,
  trailing,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  testId?: string;
  trailing?: React.ReactNode;
  last?: boolean;
}) {
  const body = (
    <>
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </>
  );
  return (
    <DropdownMenuItem
      asChild={!!href}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        MENU_ROW,
        !last && MENU_DIVIDER,
        "cursor-pointer rounded-none focus:bg-[#242527] focus:text-white",
      )}
    >
      {href ? <Link href={href}>{body}</Link> : body}
    </DropdownMenuItem>
  );
}

/**
 * Toggle row. Note the switch stays grey when on — unlike the bet panel's Auto
 * switches, these never turn green; only the knob moves.
 */
function MenuToggle({
  icon,
  label,
  checked,
  onChange,
  testId,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
  last?: boolean;
}) {
  return (
    // Not a DropdownMenuItem: selecting one would close the menu, and these are
    // meant to be flipped without losing your place.
    <div className={cn(MENU_ROW, !last && MENU_DIVIDER)}>
      {icon}
      <span className="flex-1">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        data-testid={testId}
        className="h-[19px] w-[32px] data-[state=checked]:bg-[#3a3b40] data-[state=unchecked]:bg-[#3a3b40] [&>span]:h-4 [&>span]:w-4 [&>span]:bg-[#c9cacd] [&>span]:data-[state=checked]:translate-x-[13px]"
      />
    </div>
  );
}

/**
 * Hamburger, inline rather than lucide's <Menu> so the spacing between the
 * three bars is adjustable — lucide hard-codes them at y=6/12/18 inside a
 * 24x24 viewBox, and no amount of width/height on the element reaches that
 * (preserveAspectRatio letterboxes the glyph instead of stretching it).
 *
 * GAP is the vertical distance between bars in viewBox units. 6 is lucide's
 * original; raise it to spread them, lower it to tighten. The bars stay
 * centred on y=12 whatever you pick.
 */
const GAP = 6;

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" x2="16" y1={12 - GAP} y2={12 - GAP} />
      <line x1="4" x2="16" y1={12} y2={12} />
      <line x1="4" x2="16" y1={12 + GAP} y2={12 + GAP} />
    </svg>
  );
}

/** Chat bubble from the reference's own markup; `currentColor` so the button
 *  keeps its hover state. */
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M7.8693 18.2834c-.6914 0-.9434-.6153-.5742-1.1075.252-.334.7031-.9902.955-1.4707-1.834-.8906-3.0351-2.6133-3.0351-4.5351 0-3.0235 3.0176-5.4551 6.7852-5.4551 3.7675 0 6.7851 2.4316 6.7851 5.4551 0 3.1289-3.0879 5.5195-7.2187 5.4433-1.2364.8789-2.8828 1.67-3.6973 1.67Zm.6973-1.1895c.5273-.2109 1.5761-.873 2.2793-1.3945.2343-.1817.4218-.2578.6738-.2578.2109.0058.3691.0117.4805.0117 3.123 0 5.6074-1.9219 5.6074-4.2832s-2.4844-4.2832-5.6074-4.2832S6.3927 8.8088 6.3927 11.17c0 1.5351 1.0371 2.8711 2.8243 3.7148.375.1758.4394.457.2636.7793-.2168.4043-.662.9844-.961 1.3594-.0468.0586-.0175.0996.047.0703Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Reference header (UI_SPEC_AVIATOR.md §1): wordmark left; balance, hamburger
 * and the chat toggle right — nothing else. Everything the shared TopBar
 * exposes as its own button (settings, stats, fairness, missions) lives in the
 * hamburger here, exactly like the real game.
 */
/**
 * The wordmark links back to the lobby normally; embedded it must not navigate
 * anywhere, so it degrades to a plain box that still occupies the same 84x22.
 */
function LobbyMark({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  const className = "ml-1 block h-[22px] w-[84px] shrink-0";
  if (embedded) {
    return <div className={className} aria-label="Aviator">{children}</div>;
  }
  return (
    <Link href="/" aria-label="Aviator — back to lobby" data-testid="link-lobby" className={className}>
      {children}
    </Link>
  );
}

export default function AvHeader({
  chatOpen,
  onToggleChat,
  onOpenSettings,
  onOpenStats,
  onOpenFair,
  onOpenAchievements,
  // Embedded in a partner iframe: keep the game's own controls (balance,
  // settings, stats, provably-fair) but drop everything that navigates out of
  // the game. A partner frames ONLY the game; routing their player to our
  // lobby, wallet or promotions inside their own page is a leak.
  embedded = false,
}: {
  embedded?: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  /** Omitted on the demo game, which has no seed commitment to verify. */
  onOpenFair?: () => void;
  onOpenAchievements: () => void;
}) {
  const activeGameCode = useStore((s) => s.activeGameCode) as GetWalletBalanceGame;
  const settings = useStore((s) => s.settings);
  const claimable = useStore((s) =>
    s.progression.dailyMissions.filter((m) => m.completed && !m.claimed).length,
  );
  const { user } = useAuth();
  const qc = useQueryClient();

  // Section entry-point tick, identical to lunar/TopBar.tsx's `tick`. This
  // header is the ONLY one a partner player ever gets (and the only one on
  // /aviator-pro), so the four dialog rows below were the sole entry points in
  // the whole crash game with no cue at all — measured 4 uiSelect on /play
  // against 0 here, on both surfaces. `sfx` already routes through sfxGain and
  // the uiNavAllowed gate; the `settings.sound` check mirrors TopBar so both
  // headers answer the same way if that gate ever moves.
  const tick = () => {
    unlockAudio();
    if (settings.sound) sfx.uiSelect();
  };

  const balance = useGetWalletBalance(
    { game: activeGameCode },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: activeGameCode }),
        enabled: !!user,
        refetchInterval: 300_000,
        retry: false,
      },
    },
  );

  useRealtimeTopic<{ type: string; scope?: string; balance: string }>(
    user ? `wallet:${user.id}` : null,
    (ev) => {
      if (ev?.type === "balance" && typeof ev.balance === "string") {
        qc.setQueryData(
          getGetWalletBalanceQueryKey({
            game: (ev.scope ?? "lunar") as GetWalletBalanceGame,
          }),
          (prev: unknown) =>
            prev && typeof prev === "object" ? { ...(prev as object), balance: ev.balance } : prev,
        );
      }
    },
  );
  useRealtimeResync(() => {
    if (user) qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
  });

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        disconnectRealtime();
        window.location.assign("/");
      },
    },
  });

  return (
    // z-30, not the reference's z-840: our overlays (dropdown, dialog, popover,
    // toast) all sit at z-50, so a header above that swallows its own menu.
    // px-1: the reference insets both header clusters 4px from the edge, which
    // together with the logo's own 4px margin puts the mark at x=8.
    // data-game-header marks this as the GAME's header, not platform chrome.
    // index.css's `.launcher-mode header { display:none }` exists to strip the
    // platform TopBar from embedded games; without this opt-out it would also
    // delete this bar, taking the balance readout and the whole menu with it.
    <header
      data-game-header
      className="sticky top-0 z-30 flex h-[40px] shrink-0 items-center justify-between bg-[#1b1c1d] px-1"
    >
      {/* 84x32 inset 4px. The mark is natively 108x28 (aspect 3.86), so filling
          an 84x32 box stretches it vertically — that is the intended sizing
          here, not an oversight. */}
      <LobbyMark embedded={embedded}>
        <img src={aviatorLogo} alt="Aviator" className="h-full w-full" />
      </LobbyMark>

      <div className="flex items-center gap-2">
        {/* Reference .balance: amount 14px/600 #28a909, currency 14px/500
            #9b9c9e — the currency is the same size, only greyed. */}
        <span className="text-[14px] leading-none">
          <span
            className="font-semibold tabular-nums text-[#28a909]"
            data-testid="text-balance"
          >
            {formatRupees(balance.data?.balance ?? "0")}
          </span>{" "}
          <span className="font-medium text-[#9b9c9e]">INR</span>
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={unlockAudio}
              className="relative text-[#9a9a9a] transition-colors hover:text-white"
              aria-label="Menu"
              data-testid="btn-menu"
            >
              <MenuIcon />
              {claimable > 0 && (
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-[#28a909]" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-[330px] overflow-hidden rounded-[10px] border-0 bg-[#1b1c1d] p-0 shadow-[0_8px_24px_rgba(0,0,0,.5)]"
          >
            {/* User card — 62px on the darker base */}
            {user && (
              <div className="flex h-[62px] items-center gap-3 bg-[#141517] px-[10px]">
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-white"
                  style={{ background: avatarGradient(user.displayName || user.email) }}
                >
                  {(user.displayName || user.email)[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-white">
                  {user.displayName || user.email}
                </span>
                <Link
                  href="/profile"
                  className="flex h-[38px] w-[92px] shrink-0 items-center justify-center gap-1 rounded-full border border-[#45464a] text-[11px] font-medium leading-[1.1] text-[#8a8c90] transition-colors hover:text-white"
                  data-testid="menu-change-avatar"
                >
                  <UserIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Change
                    <br />
                    Avatar
                  </span>
                </Link>
              </div>
            )}

            {/* Inline settings — these replace the old "Settings" nav row. */}
            <MenuToggle
              icon={<Volume2 className={MENU_ICON} />}
              label="Sound"
              checked={settings.sound}
              onChange={(v) => updateSettings({ sound: v })}
              testId="menu-toggle-sound"
            />
            <MenuToggle
              icon={<Music className={MENU_ICON} />}
              label="Music"
              checked={settings.music}
              onChange={(v) => updateSettings({ music: v })}
              testId="menu-toggle-music"
            />
            <MenuToggle
              icon={<Sparkles className={MENU_ICON} />}
              label="Animation"
              checked={settings.quality !== "low"}
              onChange={(v) => updateSettings({ quality: v ? "high" : "low" })}
              testId="menu-toggle-animation"
              last
            />

            <MenuSpacer />

            {/* Kept alongside the inline toggles — the dialog still holds theme,
                plane skin, trail colour, language, turbo and the volume sliders,
                which have no other entry point. */}
            <MenuRow icon={<SettingsIcon className={MENU_ICON} />} label="Settings" onClick={() => { tick(); onOpenSettings(); }} testId="menu-settings" />
            <MenuRow icon={<BarChart3 className={MENU_ICON} />} label="My stats" onClick={() => { tick(); onOpenStats(); }} testId="menu-stats" />
            <MenuRow
              icon={<Trophy className={MENU_ICON} />}
              label="Missions"
              onClick={() => { tick(); onOpenAchievements(); }}
              testId="menu-achievements"
              trailing={
                claimable > 0 ? (
                  <span className="rounded-full bg-[#28a909] px-1.5 text-[10px] font-bold text-white">
                    {claimable}
                  </span>
                ) : undefined
              }
            />
            {onOpenFair && (
              <MenuRow icon={<ShieldCheck className={MENU_ICON} />} label="Provably fair" onClick={() => { tick(); onOpenFair(); }} testId="menu-fair" last />
            )}

            <MenuSpacer />

            {/* Platform navigation — deliberately absent when embedded. Each of
                these routes the iframe out of the game and into our lobby,
                wallet or promotions, inside the partner's own page. Sign out
                is worse still: the player's session belongs to the partner. */}
            {!embedded && (
              <>
                <MenuRow icon={<HomeIcon className={MENU_ICON} />} label="Lobby" href="/" />
                <MenuRow icon={<Wallet className={MENU_ICON} />} label="Wallet" href="/wallet" />
                <MenuRow icon={<UserIcon className={MENU_ICON} />} label="Profile & KYC" href="/profile" />
                <MenuRow icon={<HistoryIcon className={MENU_ICON} />} label="History" href="/history" />
                <MenuRow icon={<Gift className={MENU_ICON} />} label="Promotions" href="/promotions" />
                <MenuRow icon={<HelpCircle className={MENU_ICON} />} label="Help" href="/help" last />
              </>
            )}

            {user && !embedded && (
              <>
                <MenuSpacer />
                <MenuRow
                  icon={<LogOut className={MENU_ICON} />}
                  label="Sign out"
                  onClick={() => logout.mutate(undefined)}
                  testId="menu-logout"
                  last
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reference shows the chat bubble only while the chat column is hidden. */}
        {!chatOpen && (
          <button
            onClick={onToggleChat}
            className="m-1 text-[#a3a3a3] transition-colors hover:text-white"
            aria-label="Open chat"
            data-testid="btn-chat-open"
          >
            <ChatIcon />
          </button>
        )}
      </div>
    </header>
  );
}
