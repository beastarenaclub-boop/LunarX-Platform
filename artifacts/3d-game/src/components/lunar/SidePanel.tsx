import { useMemo } from "react";
import type { LeaderboardEntry } from "@/game/store";
import { useStore } from "@/game/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { t } from "@/game/i18n";
import { cn } from "@/lib/utils";

function multColor(m: number) {
  if (m < 2) return "text-[#34b4ff]";
  if (m < 10) return "text-[#913ef8]";
  return "text-[#c017b4]";
}

// FREE BET badge shown on a deterministic subset of the synthetic crowd's
// cashed-out rows, matching the reference where some winners bet with a
// free bet. Hash keeps the badge stable across renders.
function isFreeBetRow(id: string): boolean {
  return hashString(id) % 8 === 0;
}

// Aviator-style masked name: first char + "***" + last char (e.g. "B***8").
function maskName(name: string): string {
  if (!name) return "***";
  if (name.length === 1) return `${name}***`;
  return `${name[0]}***${name[name.length - 1]}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Deterministic gradient derived from the name hash so each bettor keeps a
// stable avatar color across renders.
function avatarGradient(name: string): string {
  const h = hashString(name);
  const a = h % 360;
  const b = (a + 40 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 70% 45%), hsl(${b} 70% 55%))`;
}

export default function SidePanel() {
  const lang = useStore((s) => s.settings.language);
  const live = useStore((s) => s.liveBets);
  const myBets = useStore((s) => s.myBets);
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);

  const topWins = useStore((s) => s.topWins);

  const topByPayout: LeaderboardEntry[] = useMemo(() => {
    return [...topWins].sort((a, b) => b.payout - a.payout).slice(0, 50);
  }, [topWins]);

  const topByMultiplier: LeaderboardEntry[] = useMemo(() => {
    return [...topWins].sort((a, b) => b.multiplier - a.multiplier).slice(0, 50);
  }, [topWins]);

  const liveSorted = useMemo(() => {
    return [...live].sort((a, b) => b.amount - a.amount);
  }, [live]);

  return (
    <div className="flex flex-col h-full rounded-xl border border-card-border bg-card/60 overflow-hidden">
      <Tabs defaultValue="all" className="flex flex-col h-full">
        <TabsList className="grid grid-cols-3 m-2 h-8">
          <TabsTrigger value="all" className="text-xs">
            {t(lang, "allBets")}
            {live.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                {live.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="my" className="text-xs">{lang === "hi" ? "पिछले" : "Previous"}</TabsTrigger>
          <TabsTrigger value="top" className="text-xs">{t(lang, "top")}</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-hidden">
          <TabsContent value="all" className="h-full m-0 px-2 pb-2 data-[state=active]:flex flex-col">
            {/* Totals row: bet count like the reference's "3046/3051 Bets" */}
            <div className="flex items-center justify-between px-2 pb-1.5">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground leading-tight" data-testid="text-total-bets">
                  {liveSorted.length}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {lang === "hi" ? "बेट्स" : "Bets"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <span>{lang === "hi" ? "खिलाड़ी" : "Player"}</span>
              <span className="text-right">{t(lang, "bet")}</span>
              <span className="text-right">{t(lang, "payout")}</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y divide-border/50">
                {liveSorted.map((b) => {
                  // A fake bet's cashedOutAt is a *target*; only treat it as settled
                  // once the live multiplier has actually reached it.
                  const reached = b.cashedOutAt != null && multiplier >= b.cashedOutAt;
                  const isLive = phase === "flying" && (!b.cashedOutAt || !reached);
                  const isCashedThisRound = phase === "flying" && reached;
                  return (
                    <div
                      key={b.id}
                      className={cn(
                        "grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5 items-center text-xs hover-elevate rounded-md",
                        isCashedThisRound &&
                          "bg-[#123405]/70 border border-accent/30",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="w-5 h-5 text-[10px]">
                          <AvatarFallback
                            className="text-white font-semibold"
                            style={{ background: avatarGradient(b.name) }}
                          >
                            {b.name[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-muted-foreground">{maskName(b.name)}</span>
                        {isCashedThisRound && isFreeBetRow(b.id) && (
                          <span className="shrink-0 px-1.5 py-px rounded-full border border-amber-500/60 text-amber-400 text-[8px] font-bold uppercase tracking-wide">
                            Free Bet
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-right">₹{b.amount.toFixed(0)}</span>
                      <span className="font-mono text-right">
                        {isCashedThisRound && b.cashedOutAt ? (
                          <span className={cn("font-semibold", multColor(b.cashedOutAt))}>
                            {b.cashedOutAt.toFixed(2)}× • ₹{b.payout.toFixed(0)}
                          </span>
                        ) : isLive ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : phase !== "flying" && b.cashedOutAt ? (
                          <span className={cn("font-semibold", multColor(b.cashedOutAt))}>
                            {b.cashedOutAt.toFixed(2)}× • ₹{b.payout.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-destructive/70">—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {liveSorted.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {phase === "betting" ? "Waiting for round..." : "No bets this round"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="my" className="h-full m-0 px-2 pb-2 data-[state=active]:flex flex-col">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <span>{t(lang, "amount")}</span>
              <span className="text-right">{t(lang, "multiplier")}</span>
              <span className="text-right">{t(lang, "payout")}</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y divide-border/50">
                {[...myBets].reverse().slice(0, 100).map((b) => {
                  const won = b.payout > 0;
                  return (
                    <div
                      key={b.id}
                      className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5 items-center text-xs hover-elevate"
                    >
                      <span className="font-mono">₹{b.amount.toFixed(2)}</span>
                      <span
                        className={cn(
                          "font-mono text-right font-semibold",
                          b.cashedOutAt ? multColor(b.cashedOutAt) : "text-destructive/70",
                        )}
                      >
                        {b.cashedOutAt ? `${b.cashedOutAt.toFixed(2)}×` : "—"}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-right",
                          won ? "text-accent" : "text-destructive/70",
                        )}
                      >
                        {won ? `+₹${(b.payout - b.amount).toFixed(2)}` : `-₹${b.amount.toFixed(2)}`}
                      </span>
                    </div>
                  );
                })}
                {myBets.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Place your first bet!
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="top" className="h-full m-0 px-2 pb-2 data-[state=active]:flex flex-col">
            <Tabs defaultValue="payout" className="flex flex-col h-full">
              <TabsList className="grid grid-cols-2 mb-2 h-7">
                <TabsTrigger value="payout" className="text-[10px]">{t(lang, "biggestWin")}</TabsTrigger>
                <TabsTrigger value="multi" className="text-[10px]">{t(lang, "biggestMultiplier")}</TabsTrigger>
              </TabsList>

              <TabsContent value="payout" className="m-0 flex-1 min-h-0">
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>#</span>
                  <span>{t(lang, "user")}</span>
                  <span className="text-right">×</span>
                  <span className="text-right">{t(lang, "payout")}</span>
                </div>
                <ScrollArea className="flex-1 h-[calc(100%-1.25rem)]">
                  <div className="divide-y divide-border/50">
                    {topByPayout.map((e, i) => (
                      <div
                        key={e.id}
                        className={cn(
                          "grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 py-1.5 items-center text-xs hover-elevate",
                          e.isMe && "bg-accent/10",
                        )}
                      >
                        <span className="font-mono text-muted-foreground">{i + 1}</span>
                        <span className={cn("truncate", e.isMe && "text-accent font-semibold")}>{maskName(e.name)}</span>
                        <span className={cn("font-mono text-right font-semibold", multColor(e.multiplier))}>
                          {e.multiplier.toFixed(2)}×
                        </span>
                        <span className="font-mono text-right text-accent">+₹{e.payout.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="multi" className="m-0 flex-1 min-h-0">
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>#</span>
                  <span>{t(lang, "user")}</span>
                  <span className="text-right">×</span>
                  <span className="text-right">{t(lang, "payout")}</span>
                </div>
                <ScrollArea className="flex-1 h-[calc(100%-1.25rem)]">
                  <div className="divide-y divide-border/50">
                    {topByMultiplier.map((e, i) => (
                      <div
                        key={e.id}
                        className={cn(
                          "grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 py-1.5 items-center text-xs hover-elevate",
                          e.isMe && "bg-accent/10",
                        )}
                      >
                        <span className="font-mono text-muted-foreground">{i + 1}</span>
                        <span className={cn("truncate", e.isMe && "text-accent font-semibold")}>{maskName(e.name)}</span>
                        <span className={cn("font-mono text-right font-semibold", multColor(e.multiplier))}>
                          {e.multiplier.toFixed(2)}×
                        </span>
                        <span className="font-mono text-right text-accent">+₹{e.payout.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
