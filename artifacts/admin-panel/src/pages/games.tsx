import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeTopic } from "@workspace/api-client-react";
import type { GameConfigUpdatedEvent } from "@workspace/api-zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Gamepad2, ToggleRight } from "lucide-react";
import { hasRole, useAuth } from "@/lib/auth.tsx";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.VITE_API_URL || "/api";

interface GameSummary {
  id: string;
  gameCode: string;
  title: string;
  route: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

// Renders nothing; exists so we can subscribe to one realtime topic per game
// (hooks can't be called in a loop inside the parent).
function GameConfigListener({
  gameCode,
  onEvent,
}: {
  gameCode: string;
  onEvent: () => void;
}) {
  useRealtimeTopic<GameConfigUpdatedEvent>(`game-config:${gameCode}`, (ev) => {
    if (ev?.type === "updated") onEvent();
  });
  return null;
}

export default function GamesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canWrite = hasRole(user, "admin", "super_admin");

  const [pending, setPending] = useState<{
    gameCode: string;
    title: string;
    enabled: boolean;
  } | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: games, isLoading } = useQuery<GameSummary[]>({
    queryKey: ["admin-games"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/admin/games`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch games");
      return res.json();
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-games"] });
    void qc.invalidateQueries({ queryKey: ["game-config"] });
  };

  const toggle = useMutation({
    mutationFn: async ({
      gameCode,
      enabled,
      password,
    }: {
      gameCode: string;
      enabled: boolean;
      password: string;
    }) => {
      const res = await fetch(`${BASE}/game/config/${gameCode}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Confirm-Password": password,
        },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to update game");
      }
      return res.json();
    },
    onSuccess: (fresh) => {
      toast({
        title: `${pending?.title ?? fresh.gameCode} ${fresh.enabled ? "enabled" : "disabled"}`,
        description: fresh.enabled
          ? "Players can see and bet on this game again."
          : "Bets are blocked and the lobby shows it as unavailable.",
      });
      invalidate();
      setPending(null);
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ToggleRight className="h-6 w-6 text-emerald-600" />
          Games
        </h1>
        <p className="text-sm text-slate-500">
          Turn each game on or off. Disabling a game blocks bets immediately,
          hides it from the player lobby in real time, and is recorded in the
          audit log. Changes require step-up confirmation.
        </p>
      </div>

      {(games ?? []).map((g) => (
        <GameConfigListener key={g.gameCode} gameCode={g.gameCode} onEvent={invalidate} />
      ))}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-slate-500">
              Loading games…
            </div>
          ) : (games?.length ?? 0) === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500">
              No games configured.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(games ?? []).map((g) => (
                <li
                  key={g.gameCode}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  data-testid={`row-game-${g.gameCode}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
                        g.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400",
                      )}
                    >
                      <Gamepad2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.title}</div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        {g.gameCode} · {g.route}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge
                      variant={g.enabled ? "default" : "secondary"}
                      className={cn(
                        "text-[10px]",
                        g.enabled
                          ? "bg-emerald-600 hover:bg-emerald-600"
                          : "bg-slate-300 text-slate-700 hover:bg-slate-300",
                      )}
                      data-testid={`badge-status-${g.gameCode}`}
                    >
                      {g.enabled ? "LIVE" : "OFF"}
                    </Badge>
                    <Switch
                      checked={g.enabled}
                      disabled={!canWrite || toggle.isPending}
                      onCheckedChange={(next) =>
                        setPending({ gameCode: g.gameCode, title: g.title, enabled: next })
                      }
                      data-testid={`switch-game-${g.gameCode}`}
                      aria-label={`Toggle ${g.title}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setConfirmPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.enabled ? "Enable" : "Disable"} {pending?.title}?
            </DialogTitle>
            <DialogDescription>
              {pending?.enabled
                ? "Players will immediately see this game in the lobby and be able to bet."
                : "Bets will be blocked immediately and the game will show as unavailable in the lobby."}{" "}
              Enter your password to confirm this configuration change. It will
              be recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && confirmPassword && pending) {
                  toggle.mutate({
                    gameCode: pending.gameCode,
                    enabled: pending.enabled,
                    password: confirmPassword,
                  });
                }
              }}
              data-testid="input-confirm-password"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null);
                setConfirmPassword("");
              }}
              data-testid="btn-cancel-toggle"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending && confirmPassword) {
                  toggle.mutate({
                    gameCode: pending.gameCode,
                    enabled: pending.enabled,
                    password: confirmPassword,
                  });
                }
              }}
              disabled={!confirmPassword || toggle.isPending}
              data-testid="btn-confirm-toggle"
            >
              {toggle.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
