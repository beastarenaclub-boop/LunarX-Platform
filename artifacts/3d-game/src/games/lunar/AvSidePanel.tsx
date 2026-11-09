import { useEffect, useMemo, useState } from "react";
import { PlayerAvatar } from "./PlayerAvatar";
import { useStore, store } from "@/game/store";
import type { FakePlayerBet, Phase } from "@/game/store";
import { sendChat } from "@/game/engine";
import { ShieldCheck, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tierColor,
  maskName,
  fmtINR,
  fmtDDMMYY,
  withinWindow,
  type TopWindow,
} from "./avUtils";

/**
 * Reference's own shield-check for the "Provably Fair Game" footer. Same 12px
 * box the lucide icon occupied. The source svg carries no viewBox — its path
 * is drawn in a 12-unit space — so one is added here, otherwise the glyph
 * renders at its raw size and ignores the className.
 */
function FairShieldIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M5.999 11.1274c-.087 0-.2204-.0307-.3537-.1025-2.8916-1.5842-3.9016-2.3071-3.9016-4.1426V3.0627c0-.5947.2307-.8151.7332-1.0202.5588-.2307 2.4455-.9126 2.9992-1.087.1641-.046.3538-.087.523-.087.1743 0 .364.0358.528.087.5486.1846 2.4405.8563 2.9993 1.087.5025.2102.7332.4255.7332 1.0202v3.8196c0 1.8355-.969 2.6301-3.9016 4.1426-.1333.0667-.2666.1025-.359.1025ZM5.43 8.3076c.1948 0 .3589-.0974.4717-.2717l2.4045-3.7427c.0718-.1128.1333-.241.1333-.3589 0-.2666-.2358-.446-.4922-.446-.159 0-.3025.0923-.4153.2666l-2.1174 3.394-.9895-1.256c-.1333-.1641-.2563-.2257-.4153-.2257-.2615 0-.4717.2154-.4717.4768 0 .1282.0462.2513.1385.364l1.256 1.5279c.1488.1897.3026.2717.4974.2717Z"
        fill="currentColor"
      />
    </svg>
  );
}

type Tab = "all" | "previous" | "top";
type TopMetric = "x" | "win" | "rounds";

/**
 * A crowd bet's cashedOutAt is a TARGET, not a result — it only counts once
 * the multiplier has actually reached it.
 *
 * The betting phase must return false for everything: the plane has not taken
 * off, so nobody can have cashed out. This used to fall through to `return
 * true`, which turned every crowd row green and inflated "Total win INR" while
 * players were still placing bets.
 */
function isCashedOut(b: FakePlayerBet, phase: Phase, multiplier: number): boolean {
  if (b.cashedOutAt == null) return false;
  if (phase === "flying") return multiplier >= b.cashedOutAt;
  return phase === "crashed";
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  height = 32,
  testId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  height?: number;
  testId?: string;
}) {
  return (
    <div
      className="grid gap-0 rounded-full bg-[#141516] p-[2px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, height }}
      data-testid={testId}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-[#2c2d30] text-white"
              : "text-[#9a9a9a] hover:text-white",
          )}
          data-testid={`tab-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Reference .bets-list-header / .bet-list-item-column: the player column is a
// 92px block and the other three are equal, right-aligned, min 72px.
const ROW_COLS = "grid-cols-[92px_repeat(3,minmax(72px,1fr))]";

function ColumnHeader() {
  return (
    <div
      className={cn(
        "grid gap-1 p-1 pb-1 text-[10px] font-medium tracking-[-0.15px] text-[#7b7b7b]",
        ROW_COLS,
      )}
    >
      <span className="px-1">Player</span>
      <span className="px-1 text-right">Bet INR</span>
      <span className="px-1 text-right">X</span>
      <span className="px-1 text-right">Win INR</span>
    </div>
  );
}

/**
 * Reference .bet-list-item: a 32px fully-rounded pill on #101112 with a 4px
 * gap between rows — not a dense zebra table. A cashed-out row keeps the same
 * shape and just takes a 30% #427f00 wash.
 */
function BetRow({ bet, cashed }: { bet: FakePlayerBet; cashed: boolean }) {
  return (
    <div
      className={cn(
        "mt-1 grid h-[32px] items-center gap-1 rounded-full bg-[#101112] p-1 text-[12px] font-medium text-[#bbbfc5]",
        ROW_COLS,
        // #1f320d is the reference's 30% #427f00 wash over #101112, already
        // composited. It was a `bg-[linear-gradient(...),#101112]` arbitrary
        // value, which Tailwind cannot parse (a gradient AND a colour in one
        // utility) — it generated no rule at all, so winning rows silently
        // stayed grey.
        cashed && "bg-[#1f320d]",
      )}
      data-testid={`bet-row-${bet.id}`}
    >
      <div className="flex min-w-0 items-center gap-1">
        <PlayerAvatar
          name={bet.name}
          className="h-[24px] w-[24px] shrink-0 rounded-full text-center text-[11px] font-bold leading-[24px] text-white"
        />
        <span className="truncate px-1 tracking-[-0.18px]">{maskName(bet.name)}</span>
      </div>
      <span className="px-1 text-right tabular-nums">{fmtINR(bet.amount)}</span>
      <span
        className="px-1 text-right tabular-nums"
        style={{ color: cashed && bet.cashedOutAt ? tierColor(bet.cashedOutAt) : undefined }}
      >
        {cashed && bet.cashedOutAt ? `${bet.cashedOutAt.toFixed(2)}x` : ""}
      </span>
      <span className="px-1 text-right tabular-nums text-white">
        {cashed ? fmtINR(bet.payout) : ""}
      </span>
    </div>
  );
}

function TopCard({
  name,
  ts,
  amount,
  payout,
  multiplier,
  roundMax,
  onFair,
}: {
  name: string;
  ts: number;
  amount: number;
  payout: number;
  multiplier: number;
  roundMax: number | null;
  /** Absent on the demo game — nothing to verify. */
  onFair?: () => void;
}) {
  const share = () =>
    sendChat(`${maskName(name)} won ₹${fmtINR(payout)} at ${multiplier.toFixed(2)}x 🚀`);
  return (
    <div className="border-b border-[#2c2d30] px-2 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <PlayerAvatar
          name={name}
          className="h-[26px] w-[26px] shrink-0 rounded-full text-center text-[11px] font-bold leading-[26px] text-white"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[11px] text-white/90">{maskName(name)}</div>
          <div className="text-[10px] text-[#6b6b6b] tabular-nums">{fmtDDMMYY(ts)}</div>
        </div>
        <button
          onClick={share}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#2c2d30] text-[#6b6b6b] transition-colors hover:text-white"
          aria-label="Share to chat"
        >
          <MessageSquare className="h-3 w-3" />
        </button>
        {onFair && (
          <button
            onClick={onFair}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#2c2d30] text-[#6b6b6b] transition-colors hover:text-white"
            aria-label="Verify fairness"
          >
            <ShieldCheck className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <Pair label="Bet INR" value={fmtINR(amount)} />
        <Pair label="Result" value={`${multiplier.toFixed(2)}x`} color={tierColor(multiplier)} />
        <Pair label="Win INR" value={fmtINR(payout)} />
        <Pair
          label="Round max."
          value={roundMax != null ? `${roundMax.toFixed(2)}x` : "—"}
          color={roundMax != null ? tierColor(roundMax) : undefined}
        />
      </div>
    </div>
  );
}

function Pair({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-[#6b6b6b]">{label}</span>
      <span className="text-[11px] font-medium tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </span>
    </div>
  );
}

export default function AvSidePanel({ onOpenFair }: { onOpenFair?: () => void }) {
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);
  const liveBets = useStore((s) => s.liveBets);
  const topWins = useStore((s) => s.topWins);
  const rounds = useStore((s) => s.rounds);

  const [tab, setTab] = useState<Tab>("all");
  const [metric, setMetric] = useState<TopMetric>("x");
  const [window, setWindow] = useState<TopWindow>("day");

  // The store only holds the CURRENT round's bets, so the Previous tab keeps
  // its own snapshot taken the moment the plane flies away.
  const [prev, setPrev] = useState<{ bets: FakePlayerBet[]; crashAt: number } | null>(null);
  useEffect(() => {
    if (phase === "crashed") {
      const s = store.getState();
      setPrev({ bets: s.liveBets, crashAt: s.crashAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const sorted = useMemo(() => [...liveBets].sort((a, b) => b.amount - a.amount), [liveBets]);

  const cashedCount = sorted.filter((b) => isCashedOut(b, phase, multiplier)).length;
  const totalWin = sorted.reduce(
    (acc, b) => acc + (isCashedOut(b, phase, multiplier) ? b.payout : 0),
    0,
  );
  const progressPct = sorted.length ? (cashedCount / sorted.length) * 100 : 0;

  const now = Date.now();
  const topEntries = useMemo(() => {
    const inWindow = topWins.filter((e) => withinWindow(e.ts, window, now));
    return [...inWindow]
      .sort((a, b) => (metric === "win" ? b.payout - a.payout : b.multiplier - a.multiplier))
      .slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topWins, window, metric]);

  const topRounds = useMemo(
    () => [...rounds].sort((a, b) => b.crashAt - a.crashAt).slice(0, 50),
    [rounds],
  );

  return (
    // .bets-block — everything inside is inset 8px from the panel edge.
    <div className="flex h-full flex-col overflow-hidden rounded-[20px] bg-[#1b1c1d] p-2">
      <div className="pb-1">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          testId="tabs-side-panel"
          options={[
            { value: "all", label: "All Bets" },
            { value: "previous", label: "Previous" },
            { value: "top", label: "Top" },
          ]}
        />
      </div>

      {tab === "all" && (
        <>
          {/* .total-win-container — 68px card, radius 14, on #141516.
              Avatars and the win figure share the top row; the bet counts and
              the "Total win" caption share the second; the 8px progress bar
              runs underneath. */}
          <div className="flex h-[68px] shrink-0 flex-col justify-center rounded-[14px] bg-[#141516] p-2">
            <div className="mb-1 flex h-[20px] items-center justify-between">
              <div className="flex">
                {sorted.slice(0, 3).map((b, i) => (
                  <PlayerAvatar
                    key={b.id}
                    name={b.name}
                    className="h-[24px] w-[24px] rounded-full border-2 border-white text-center text-[10px] font-bold leading-[28px] text-white"
                    style={{ marginLeft: i ? -10 : 0 }}
                  />
                ))}
              </div>
              <span
                className="text-[16px] font-semibold leading-[18px] tabular-nums text-[#cccccc]"
                data-testid="text-total-win"
              >
                {fmtINR(totalWin)}
              </span>
            </div>
            <div className="mb-1 flex h-[16px] items-center justify-between text-[12px]">
              <span>
                <span className="font-medium tabular-nums text-[#cccccc]" data-testid="text-bet-counts">
                  {cashedCount}/{sorted.length}
                </span>
                <span className="pl-1 text-[#7b7b7b]">Bets</span>
              </span>
              <span className="text-[#7b7b7b]">Total win INR</span>
            </div>
            <div className="h-[8px] w-full overflow-hidden rounded-full bg-[#2b2b2b]/50 p-[2px]">
              <div
                className="h-full rounded-full bg-[#427f00] transition-[width] duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <ColumnHeader />
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sorted.map((b, i) => (
              <BetRow key={b.id} bet={b} cashed={isCashedOut(b, phase, multiplier)} />
            ))}
            {sorted.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] text-[#6b6b6b]">
                Waiting for round…
              </div>
            )}
          </div>
        </>
      )}

      {tab === "previous" && (
        <>
          <div className="py-2 text-center">
            <div className="text-[10px] text-[#6b6b6b]">Round Result</div>
            <div
              className="text-[24px] font-bold leading-tight tabular-nums"
              style={{ color: prev ? tierColor(prev.crashAt) : "#6b6b6b" }}
              data-testid="text-previous-result"
            >
              {prev ? `${prev.crashAt.toFixed(2)}x` : "—"}
            </div>
          </div>
          <ColumnHeader />
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {prev?.bets.map((b) => (
              <BetRow key={b.id} bet={b} cashed={b.cashedOutAt != null} />
            ))}
            {!prev?.bets.length && (
              <div className="px-2 py-6 text-center text-[11px] text-[#6b6b6b]">
                No previous round yet
              </div>
            )}
          </div>
        </>
      )}

      {tab === "top" && (
        <>
          <div className="space-y-1 px-1 pb-1">
            <Segmented<TopMetric>
              value={metric}
              onChange={setMetric}
              height={24}
              options={[
                { value: "x", label: "X" },
                { value: "win", label: "Win" },
                { value: "rounds", label: "Rounds" },
              ]}
            />
            <Segmented<TopWindow>
              value={window}
              onChange={setWindow}
              height={24}
              options={[
                { value: "day", label: "Day" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
            />
          </div>
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {metric === "rounds"
              ? topRounds.map((r) => (
                  <div
                    key={`${r.id}_${r.nonce}`}
                    className="flex items-center justify-between border-b border-[#2c2d30] px-2 py-2"
                  >
                    <div className="leading-tight">
                      <div className="text-[11px] text-white/90">Round #{r.nonce}</div>
                      <div className="text-[10px] tabular-nums text-[#6b6b6b]">
                        {fmtDDMMYY(r.ts)}
                      </div>
                    </div>
                    <span
                      className="text-[15px] font-bold tabular-nums"
                      style={{ color: tierColor(r.crashAt) }}
                    >
                      {r.crashAt.toFixed(2)}x
                    </span>
                  </div>
                ))
              : topEntries.map((e) => (
                  <TopCard
                    key={e.id}
                    name={e.name}
                    ts={e.ts}
                    amount={e.amount}
                    payout={e.payout}
                    multiplier={e.multiplier}
                    roundMax={null}
                    onFair={onOpenFair}
                  />
                ))}
            {((metric === "rounds" && !topRounds.length) ||
              (metric !== "rounds" && !topEntries.length)) && (
              <div className="px-2 py-6 text-center text-[11px] text-[#6b6b6b]">
                Nothing here yet
              </div>
            )}
          </div>
        </>
      )}

      {/* .bets-widget-footer — 32px, no rule above it in the reference */}
      <div className="flex h-[32px] shrink-0 items-center justify-between px-1">
        {onOpenFair ? (
          <button
            onClick={onOpenFair}
            className="flex h-[12px] items-center gap-1.5 px-1 text-[10px] font-medium leading-[12px] text-[#a3a3a3] transition-colors hover:text-white"
            data-testid="btn-provably-fair-footer"
          >
            <FairShieldIcon />
            Provably Fair Game
          </button>
        ) : (
          <span />
        )}
        {/* "Powered by" stays the muted label; LUNAR is set as a wordmark to
            match the 36x10 logo slot it sits in — bold, uppercase, #a3a3a3,
            the same fill the footer's shield and the reference's mark use.
            Swap the inner span for an <img> if a real LUNAR SVG turns up. */}
        <span className="px-1 text-[10px] font-medium leading-[12px] text-[#525252]">
          Powered by{" "}
          <span className="font-bold tracking-[0.04em] text-[#a3a3a3]">LUNAR</span>
        </span>
      </div>
    </div>
  );
}
