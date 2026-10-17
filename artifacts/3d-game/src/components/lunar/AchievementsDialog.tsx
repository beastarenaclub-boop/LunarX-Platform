import { useStore } from "@/game/store";
import { useDialogSound } from "@/game/useDialogSound";
import { claimMissionReward, LEVEL_REWARDS } from "@/game/engine";
import { ACHIEVEMENTS, xpForNextLevel } from "@/game/progression";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  Plane,
  Coins,
  TrendingUp,
  Rocket,
  Sparkles,
  Star,
  Flame,
  Zap,
  Target,
  Award,
  Medal,
  Crown,
  Lock,
  Check,
  Gift,
  Palette,
} from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Plane,
  Coins,
  TrendingUp,
  Rocket,
  Sparkles,
  Star,
  Flame,
  Zap,
  Trophy,
  Target,
  Award,
  Medal,
  Crown,
};

function CountdownToReset({ ts }: { ts: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000 * 30);
    return () => clearInterval(id);
  }, []);
  if (!ts) return null;
  const next = ts + 24 * 60 * 60 * 1000;
  const diff = Math.max(0, next - Date.now());
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return (
    <span className="text-[10px] text-muted-foreground">
      Resets in {h}h {m}m
    </span>
  );
}

export default function AchievementsDialog({ open, onOpenChange }: Props) {
  const progression = useStore((s) => s.progression);
  useDialogSound(open);
  const { level, xp, totalXp, achievements, dailyMissions, dailyMissionsRolledAt } = progression;
  const needed = xpForNextLevel(level);
  const unlockedCount = Object.keys(achievements).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-accent" />
            Progression
          </DialogTitle>
        </DialogHeader>

        {/* Level header */}
        <div className="rounded-lg border border-card-border bg-card/60 p-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15 text-primary font-mono font-bold">
                {level}
              </div>
              <div>
                <div className="text-sm font-semibold">Level {level}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {totalXp.toLocaleString()} total XP
                </div>
              </div>
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {xp} / {needed} XP
            </div>
          </div>
          <Progress value={(xp / needed) * 100} className="h-2" />
        </div>

        <Tabs defaultValue="missions" className="mt-3">
          <TabsList className="grid grid-cols-3 h-9">
            <TabsTrigger value="missions" className="text-xs">
              Daily
            </TabsTrigger>
            <TabsTrigger value="achievements" className="text-xs">
              Achievements ({unlockedCount}/{ACHIEVEMENTS.length})
            </TabsTrigger>
            <TabsTrigger value="rewards" className="text-xs">
              Rewards
            </TabsTrigger>
          </TabsList>

          {/* Daily missions */}
          <TabsContent value="missions" className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                3 daily goals
              </div>
              <CountdownToReset ts={dailyMissionsRolledAt} />
            </div>
            {dailyMissions.length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">
                Missions will appear shortly...
              </div>
            )}
            {dailyMissions.map((m) => {
              const pct = Math.min(100, (m.progress / m.goal) * 100);
              const isProfit = m.metric === "profit";
              return (
                <div
                  key={m.id}
                  className="rounded-lg border border-card-border bg-card/60 p-3"
                  data-testid={`mission-${m.templateId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        <Target className="w-3.5 h-3.5 text-accent" />
                        {m.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {m.description}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      +{m.xp} XP
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">
                      {isProfit
                        ? `${Math.floor(m.progress)}/${m.goal}`
                        : `${m.progress}/${m.goal}`}
                    </span>
                  </div>
                  {m.completed && (
                    <Button
                      size="sm"
                      variant={m.claimed ? "outline" : "default"}
                      className="w-full mt-2 h-7 text-xs"
                      disabled={m.claimed}
                      onClick={() => claimMissionReward(m.id)}
                      data-testid={`claim-${m.templateId}`}
                    >
                      {m.claimed ? (
                        <>
                          <Check className="w-3 h-3 mr-1" /> Claimed
                        </>
                      ) : (
                        <>
                          <Gift className="w-3 h-3 mr-1" /> Claim +{m.xp} XP
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </TabsContent>

          {/* Achievements */}
          <TabsContent value="achievements" className="mt-3 space-y-2">
            {ACHIEVEMENTS.map((a) => {
              const unlocked = !!achievements[a.id];
              const Icon = ICONS[a.icon] ?? Trophy;
              return (
                <div
                  key={a.id}
                  className={`rounded-lg border p-3 flex items-center gap-3 ${
                    unlocked
                      ? "border-accent/40 bg-accent/5"
                      : "border-card-border bg-card/60 opacity-70"
                  }`}
                  data-testid={`achievement-${a.id}`}
                >
                  <div
                    className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
                      unlocked ? "bg-accent/15 text-accent" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {unlocked ? <Icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {a.title}
                      {unlocked && (
                        <Check className="w-3 h-3 text-accent" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.description}</div>
                  </div>
                  <Badge
                    variant={unlocked ? "default" : "secondary"}
                    className="text-[10px] shrink-0"
                  >
                    +{a.xp}
                  </Badge>
                </div>
              );
            })}
          </TabsContent>

          {/* Rewards */}
          <TabsContent value="rewards" className="mt-3 space-y-2">
            <div className="text-xs text-muted-foreground mb-1">
              Level up to unlock cosmetic rewards. Equip them in Settings.
            </div>
            {LEVEL_REWARDS.map((r, i) => {
              const unlocked = level >= r.level;
              return (
                <div
                  key={i}
                  className={`rounded-lg border p-3 flex items-center gap-3 ${
                    unlocked
                      ? "border-accent/40 bg-accent/5"
                      : "border-card-border bg-card/60 opacity-70"
                  }`}
                  data-testid={`reward-lv${r.level}-${r.kind}`}
                >
                  <div
                    className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${
                      unlocked ? "bg-accent/15 text-accent" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {unlocked ? (
                      r.kind === "skin" ? (
                        <Plane className="w-4 h-4" />
                      ) : (
                        <Palette className="w-4 h-4" />
                      )
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      {r.label}
                      {r.kind === "trail" && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-border"
                          style={{ background: r.value }}
                        />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {r.kind} • Level {r.level}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    Lv {r.level}
                  </Badge>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
