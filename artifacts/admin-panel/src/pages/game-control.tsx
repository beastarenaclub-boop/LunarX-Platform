import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const API = "/api/admin/game-control";
type Param = string | number | boolean | null;
type Engine = {
  floorMode: string;
  effectiveFloorPaise: string;
  effectiveBudgetPaise: string;
  mode: string;
  revision: string;
  bankPaise: string;
  budgetPaise: string;
  minBankFloorPaise: string;
  params: Record<string, Param>;
  forcedChoice: string | null;
};
type Game = {
  game: {
    gameCode: string;
    enabled: boolean;
    houseEdge: number;
    ftDigitReturn: number;
    maxPerSpotPaise: string;
  };
  supported: boolean;
  reason: string;
  engine: Engine | null;
};
type Budget = {
  mode: string;
  budgetPaise: string | null;
  combinedBankPaise: string;
};
type Response = {
  games: Game[];
  modes: string[];
  bounds: Record<string, { min: number; max: number; integer: boolean }>;
  budget: Budget;
};
const rupees = (p: string) => {
  const n = BigInt(p),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};
const money = (p: string) =>
  (Number(p) / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
  });
function paise(value: string) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter rupees with at most two decimal places.");
  const neg = value.startsWith("-"),
    [whole, fraction = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (neg ? -1n : 1n)
  ).toString();
}
const title = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Bps$/, "(basis points)")
    .replace(/Pct$/, "(fraction)")
    .replace(/^./, (x) => x.toUpperCase());
const names: Record<string, string> = {
  rtpHoldBps: "House hold (basis points; 1000 = 90% RTP)",
  rtpRoundCapBps: "Extra return aim per round (basis points; 0 = unlimited)",
  rtpAggressivenessEnabled: "Pace RTP recovery",
  rtpNoiseEnabled: "Allow natural draws in RTP mode",
  noiseRate: "Natural draw rate (0.15 = 15%)",
  targetHoldPct: "Auto target hold (0.07 = 7%)",
  targetBankPaise: "Target bank (₹)",
};
const selectClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900";
const enums: Record<string, string[]> = {
  rtpHistoryScope: ["all", "7d", "24h", "none"],
  partyHistoryScope: ["all", "7d", "24h", "none"],
  rtpRecoveryMode: ["target", "recover"],
  partyBalanceMode: ["rtpBand", "noLoser"],
};

function Editor({
  item,
  bounds,
  onSaved,
}: {
  item: Game;
  bounds: Response["bounds"];
  onSaved: () => void;
}) {
  const engine = item.engine!,
    code = item.game.gameCode;
  const [mode, setMode] = useState(engine.mode),
    [params, setParams] = useState(engine.params);
  const [budget, setBudget] = useState(rupees(engine.budgetPaise)),
    [budgetDirty, setBudgetDirty] = useState(false);
  const [target, setTarget] = useState(
    engine.params.targetBankPaise === null
      ? ""
      : rupees(String(engine.params.targetBankPaise)),
  );
  const [choice, setChoice] = useState("");
  const [digitReturn, setDigitReturn] = useState(item.game.ftDigitReturn);
  const hasSpotLimit = [
    "roulette-american",
    "roulette-mini",
    "fun-target",
  ].includes(code);
  const [spotLimit, setSpotLimit] = useState(rupees(item.game.maxPerSpotPaise));
  const [historyOpen, setHistoryOpen] = useState(false);
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () =>
      customFetch(`${API}/${code}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          revision: engine.revision,
          ...(hasSpotLimit ? { maxPerSpotPaise: paise(spotLimit) } : {}),
          ...(code === "fun-target" ? { digitReturn } : {}),
          params: {
            ...params,
            targetBankPaise: target.trim() ? paise(target) : null,
          },
          ...(budgetDirty ? { budgetPaise: paise(budget) } : {}),
        }),
      }),
    onSuccess: () => {
      toast({
        title: "Game Control saved",
        description: "The next result decision uses these settings.",
      });
      onSaved();
    },
    onError: (e: Error) =>
      toast({
        title: "Could not save",
        description: e.message,
        variant: "destructive",
      }),
  });
  const choices = useQuery<{ id: string; label: string }[]>({
    queryKey: [API, code, "choices"],
    queryFn: () => customFetch(`${API}/${code}/choices`),
  });
  const history = useQuery<{
    decisions: {
      roundId: string;
      winningChoice: string;
      mode: string;
      createdAt: string;
      meta: { reason?: string; alerts?: string[] };
    }[];
    ledger: {
      roundId: string;
      totalStakesPaise: string;
      totalPayoutsPaise: string;
      balanceAfterPaise: string;
    }[];
  }>({
    queryKey: [API, code, "history"],
    queryFn: () => customFetch(`${API}/${code}/history`),
    enabled: historyOpen,
    refetchInterval: historyOpen ? 10000 : false,
  });
  const force = useMutation({
    mutationFn: (choiceId: string | null) =>
      customFetch(`${API}/${code}/force`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choiceId }),
      }),
    onSuccess: () => {
      toast({ title: "Next-result setting updated" });
      onSaved();
    },
    onError: (e: Error) =>
      toast({
        title: "Could not set result",
        description: e.message,
        variant: "destructive",
      }),
  });
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-slate-500">Settled bank</p>
          <strong>{money(engine.bankPaise)}</strong>
        </div>
        <div>
          <p className="text-sm text-slate-500">
            {engine.floorMode === "combined"
              ? "Combined remaining budget"
              : "Remaining loss budget"}
          </p>
          <strong>{money(engine.effectiveBudgetPaise)}</strong>
        </div>
        <div>
          <p className="text-sm text-slate-500">
            {engine.floorMode === "combined"
              ? "Combined bank floor"
              : "Bank floor"}
          </p>
          <strong>{money(engine.effectiveFloorPaise)}</strong>
        </div>
      </div>
      {engine.floorMode === "combined" && (
        <p className="text-sm text-slate-600">
          The combined budget above is active. The per-game budget below is
          retained for use when the shared policy returns to separate budgets.
        </p>
      )}
      <p className="text-sm text-slate-600">
        Normal uses the game's natural draw. Collect favors house returns.
        Distribute spends toward a target bank. Auto follows a rolling hold
        target. RTP follows settled return history. Actual returns vary with the
        bets and available outcomes.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          Result mode
          <select
            aria-label="Result mode"
            className={selectClass}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {["normal", "collect", "distribute", "auto", "rtp"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Loss budget from now (₹)
          <Input
            aria-label="Loss budget from now"
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              setBudgetDirty(true);
            }}
          />
          <span className="text-xs text-slate-500">
            Saving an edited budget fixes the floor against the live bank.
          </span>
        </label>
        <label className="text-sm">
          Target bank (₹)
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="No target"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setMode("rtp");
            setParams({
              ...params,
              rtpHoldBps: 1000,
              rtpRecoveryMode: "target",
              rtpHistoryScope: "all",
              rtpAggressivenessEnabled: false,
              rtpNoiseEnabled: false,
            });
          }}
        >
          90% RTP preset
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMode("auto");
            setParams({ ...params, targetHoldPct: 0.07, windowRounds: 200 });
          }}
        >
          Auto 7% hold preset
        </Button>
      </div>
      {hasSpotLimit && (
        <label className="block text-sm max-w-xs">
          Maximum per position per player (₹)
          <Input
            aria-label="Maximum per position"
            value={spotLimit}
            onChange={(e) => setSpotLimit(e.target.value)}
          />
          <span className="text-xs text-slate-500">
            Combines all chips on the same position during a round. New rounds
            use the saved limit.
          </span>
        </label>
      )}
      {code === "fun-target" && (
        <label className="block text-sm max-w-xs">
          Winning digit total return (includes stake)
          <Input
            aria-label="Winning digit total return"
            type="number"
            min={1}
            max={10}
            step={0.01}
            value={digitReturn}
            onChange={(e) => setDigitReturn(Number(e.target.value))}
          />
          <span className="text-xs text-slate-500">
            Applies to rounds opened after saving. Natural-draw RTP is this
            return divided by 10.
          </span>
        </label>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          RTP, pacing and balance settings
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(params)
            .filter(([k]) => k !== "targetBankPaise")
            .map(([key, value]) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                {names[key] ?? title(key)}
                {typeof value === "boolean" ? (
                  <input
                    className="h-5 w-5"
                    aria-label={names[key] ?? title(key)}
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      setParams({ ...params, [key]: e.target.checked })
                    }
                  />
                ) : enums[key] ? (
                  <select
                    className={selectClass}
                    value={String(value)}
                    onChange={(e) =>
                      setParams({ ...params, [key]: e.target.value })
                    }
                  >
                    {enums[key].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    type="number"
                    value={String(value)}
                    min={bounds[key]?.min}
                    max={bounds[key]?.max}
                    step={bounds[key]?.integer ? 1 : "any"}
                    onChange={(e) =>
                      setParams({
                        ...params,
                        [key]:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                  />
                )}
              </label>
            ))}
        </div>
      </details>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save game settings"}
      </Button>
      <div className="border-t pt-4 space-y-2">
        <p className="font-medium">Next result</p>
        <p className="text-sm text-slate-600">
          Applies once, expires after five minutes, and is cleared by a server
          restart. Recorded in decision history. Rummy selects a deal; player
          actions can change the final result.
        </p>
        <p className="text-sm">Armed: {engine.forcedChoice ?? "None"}</p>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Next result"
            className={selectClass + " max-w-xs"}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Choose a result</option>
            {choices.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!choice || force.isPending}
            onClick={() => force.mutate(choice)}
          >
            Set next result
          </Button>
          <Button
            variant="outline"
            disabled={force.isPending}
            onClick={() => force.mutate(null)}
          >
            Clear
          </Button>
        </div>
      </div>
      <Button variant="outline" onClick={() => setHistoryOpen(!historyOpen)}>
        {historyOpen ? "Hide" : "Show"} decisions and bank ledger
      </Button>
      {historyOpen && (
        <div className="space-y-4 overflow-x-auto">
          {history.isError && <p role="alert">Could not load history.</p>}
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Round / mode</th>
                <th className="text-left">Result and reason</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.decisions.map((d) => (
                <tr className="border-t" key={d.roundId}>
                  <td className="py-2 pr-4">
                    {d.roundId}
                    <br />
                    {d.mode}
                  </td>
                  <td>
                    {d.winningChoice}
                    <br />
                    {d.meta?.reason}
                    <br />
                    {d.meta?.alerts?.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Round</th>
                <th>Stake</th>
                <th>Paid</th>
                <th>Bank after</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.ledger.map((l) => (
                <tr key={l.roundId}>
                  <td>{l.roundId}</td>
                  <td>{money(l.totalStakesPaise)}</td>
                  <td>{money(l.totalPayoutsPaise)}</td>
                  <td>{money(l.balanceAfterPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GameControl() {
  const qc = useQueryClient(),
    { toast } = useToast();
  const query = useQuery<Response>({
    queryKey: [API],
    queryFn: () => customFetch(API),
  });
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const [budgetMode, setBudgetMode] = useState("per_game"),
    [budget, setBudget] = useState("");
  useEffect(() => {
    if (query.data) {
      setBudgetMode(query.data.budget.mode);
      setBudget(
        query.data.budget.budgetPaise === null
          ? ""
          : rupees(query.data.budget.budgetPaise),
      );
    }
  }, [query.data?.budget.mode, query.data?.budget.budgetPaise]);
  const refresh = () => qc.invalidateQueries({ queryKey: [API] });
  const saveBudget = useMutation({
    mutationFn: () =>
      customFetch(`${API}/budget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: budgetMode,
          ...(budgetMode === "per_game" ? {} : { budgetPaise: paise(budget) }),
        }),
      }),
    onSuccess: () => {
      toast({ title: "Budget saved" });
      void refresh();
    },
    onError: (e: Error) =>
      toast({
        title: "Budget not saved",
        description: e.message,
        variant: "destructive",
      }),
  });
  if (query.isPending) return <p>Loading Game Control…</p>;
  if (query.isError)
    return (
      <p role="alert">Could not load Game Control: {query.error.message}</p>
    );
  const data = query.data,
    item = data.games.find((g) => g.game.gameCode === selected);
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Game Control</h1>
          <p className="text-slate-500">
            Result modes, RTP targets and loss budgets across your games.
          </p>
        </div>
        <a href={`${API}/export`} className="text-sm underline">
          Export settings
        </a>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Bank budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Current policy: {data.budget.mode.replaceAll("_", " ")} · Combined
            bank: {money(data.budget.combinedBankPaise)}
            {data.budget.budgetPaise !== null
              ? ` · Budget: ${money(data.budget.budgetPaise)}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="Bank budget policy"
              className={selectClass + " max-w-xs"}
              value={budgetMode}
              onChange={(e) => setBudgetMode(e.target.value)}
            >
              <option value="per_game">Separate budget per game</option>
              <option value="same_each">Same budget for every game</option>
              <option value="combined">One combined budget</option>
            </select>
            {budgetMode !== "per_game" && (
              <Input
                className="max-w-xs"
                aria-label="Shared budget in rupees"
                placeholder="Budget in ₹"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            )}
            <Button
              disabled={saveBudget.isPending}
              onClick={() => saveBudget.mutate()}
            >
              Save budget policy
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Budgets apply to games connected to this result engine. Normal draws
            and operator forces follow their own outcomes.
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardContent className="pt-5">
            <Input
              aria-label="Search games"
              placeholder="Search games"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-3 space-y-1 max-h-[650px] overflow-y-auto">
              {data.games
                .filter((g) => g.game.gameCode.includes(search.toLowerCase()))
                .map((g) => (
                  <button
                    key={g.game.gameCode}
                    onClick={() => setSelected(g.game.gameCode)}
                    className={`w-full rounded p-3 text-left text-sm ${selected === g.game.gameCode ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
                  >
                    <span className="block font-medium">{g.game.gameCode}</span>
                    <span className="text-xs opacity-70">
                      {g.engine?.mode ?? "Own draw engine"} ·{" "}
                      {g.game.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </button>
                ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{item?.game.gameCode ?? "Select a game"}</CardTitle>
          </CardHeader>
          <CardContent>
            {item ? (
              item.engine ? (
                <Editor
                  key={`${selected}:${item.engine.revision}`}
                  item={item}
                  bounds={data.bounds}
                  onSaved={() => void refresh()}
                />
              ) : (
                <div className="space-y-3">
                  <p>{item.reason}</p>
                  <p>
                    Configured return:{" "}
                    {((1 - item.game.houseEdge) * 100).toFixed(2)}%
                  </p>
                  <Link href="/rtp" className="underline">
                    Open Game Defaults for RTP, payouts and limits
                  </Link>
                </div>
              )
            ) : (
              <p className="text-slate-500">
                Choose any game to inspect its available controls.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
