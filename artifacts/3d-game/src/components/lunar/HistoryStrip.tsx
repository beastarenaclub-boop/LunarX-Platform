import { useState } from "react";
import { useStore } from "@/game/store";
import type { RoundResult } from "@/game/store";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { History, Copy, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

// Aviator-style tiers: blue < 2×, purple 2×–10×, pink/magenta ≥ 10× —
// rendered as small rounded pills of colored text on a near-black bar.
function colorFor(m: number): string {
  if (m < 2) return "text-[#34b4ff]";
  if (m < 10) return "text-[#913ef8]";
  return "text-[#c017b4]";
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Copied");
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="shrink-0 p-1 rounded hover-elevate text-muted-foreground"
      title="Copy"
      data-testid="button-copy-seed"
    >
      {copied ? <Check className="w-3 h-3 text-accent" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-20 shrink-0 uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="flex-1 min-w-0 truncate font-mono text-foreground/90">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

function RoundCard({ round }: { round: RoundResult }) {
  return (
    <div className="rounded-lg border border-card-border bg-card/60 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-black/60",
            colorFor(round.crashAt),
          )}
        >
          {round.crashAt.toFixed(2)}×
        </span>
        <span className="text-[10px] text-muted-foreground">{fmtTime(round.ts)}</span>
      </div>
      <div className="space-y-1">
        <DetailRow label="Hash" value={round.serverSeedHash} />
        <DetailRow label="Client" value={round.clientSeed} />
        <DetailRow label="Nonce" value={String(round.nonce)} />
        {round.serverSeed && <DetailRow label="Server" value={round.serverSeed} />}
      </div>
    </div>
  );
}

export default function HistoryStrip() {
  const history = useStore((s) => s.history);
  const isJetX = useStore(s => s.activeGameCode === "jetx");
  const rounds = useStore((s) => s.rounds);
  const [open, setOpen] = useState(false);

  const recentRounds = [...rounds].slice(-50).reverse();

  return (
    <div className="crash-history flex items-center gap-1.5 py-1.5 px-2 rounded-xl bg-[#101010] border border-card-border">
      {isJetX && <span className="jetx-history-label"><History size={14} /><span>RECENT FLIGHTS</span></span>}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-thin flex-1 min-w-0">
        {history.length === 0 ? (
          <div className="text-xs text-muted-foreground px-2 py-1">No rounds yet</div>
        ) : (
          history.map((m, i) => (
            <div
              key={i}
              data-multiplier-tier={m < 2 ? "low" : m < 10 ? "medium" : "high"}
              className={cn(
                "shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-black/60",
                colorFor(m),
              )}
              title={`Round ${history.length - i}: ${m.toFixed(2)}x`}
            >
              {m.toFixed(2)}×
            </div>
          ))
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7"
            title="Round history"
            data-testid="button-round-history"
          >
            {isJetX ? <ChevronDown className="w-4 h-4" /> : <History className="w-4 h-4" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-2">
            Round History
          </div>
          {recentRounds.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">No rounds yet</div>
          ) : (
            <ScrollArea className="max-h-[300px] pr-2">
              <div className="space-y-1.5">
                {recentRounds.map((r) => (
                  <RoundCard key={`${r.id}_${r.nonce}`} round={r} />
                ))}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
