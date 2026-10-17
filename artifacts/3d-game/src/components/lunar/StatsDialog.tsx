import { useMemo } from "react";
import { useStore } from "@/game/store";
import { useDialogSound } from "@/game/useDialogSound";
import { t } from "@/game/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function StatsDialog({ open, onOpenChange }: Props) {
  const lang = useStore((s) => s.settings.language);
  const myBets = useStore((s) => s.myBets);
  useDialogSound(open);

  const stats = useMemo(() => {
    const settled = myBets.filter((b) => b.multiplier !== undefined);
    const wins = settled.filter((b) => b.payout > 0);
    const totalBet = settled.reduce((a, b) => a + b.amount, 0);
    const totalReturn = settled.reduce((a, b) => a + b.payout, 0);
    const biggestWin = Math.max(0, ...wins.map((b) => b.payout - b.amount));
    const biggestMult = Math.max(1, ...wins.map((b) => b.cashedOutAt ?? 0));
    const winRate = settled.length ? (wins.length / settled.length) * 100 : 0;

    let cum = 0;
    const data = settled.map((b, i) => {
      cum += b.payout - b.amount;
      return { i: i + 1, profit: +cum.toFixed(2) };
    });
    return {
      rounds: settled.length,
      winRate,
      biggestWin,
      biggestMult,
      netProfit: totalReturn - totalBet,
      data,
    };
  }, [myBets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(lang, "statistics")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <Stat label={t(lang, "rounds")} value={stats.rounds.toString()} />
          <Stat label={t(lang, "winRate")} value={`${stats.winRate.toFixed(1)}%`} accent />
          <Stat
            label={t(lang, "biggestWin")}
            value={`+₹${stats.biggestWin.toFixed(0)}`}
            accent
          />
          <Stat label={t(lang, "biggestMultiplier")} value={`${stats.biggestMult.toFixed(2)}×`} />
        </div>

        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t(lang, "profitOverTime")} •{" "}
            <span
              className={
                stats.netProfit >= 0 ? "text-accent font-semibold" : "text-destructive font-semibold"
              }
            >
              {stats.netProfit >= 0 ? "+" : ""}
              ₹{stats.netProfit.toFixed(2)}
            </span>
          </div>
          <div className="h-64 w-full bg-card/50 rounded-lg p-2 border border-card-border">
            {stats.data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Place bets to see your performance over time.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.data}>
                  <defs>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="i" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="hsl(var(--accent))"
                    fill="url(#prof)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-card-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-mono font-bold mt-1 ${
          accent ? "text-accent" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
