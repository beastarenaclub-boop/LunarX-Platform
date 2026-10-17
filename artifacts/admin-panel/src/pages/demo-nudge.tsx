import { useState } from "react";
import { useAdminDemoNudgeStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TRIGGER_LABELS: Record<string, string> = {
  rounds: "After several rounds",
  bigwin: "After a big win",
  lowbalance: "When balance gets low",
};

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

export default function DemoNudgePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useAdminDemoNudgeStats({ days });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Demo signup nudges</h1>
          <p className="text-sm text-slate-500">
            How often each in-game nudge converts demo players into real
            signups.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Window
          </label>
          <select
            data-testid="select-nudge-days"
            className="border rounded px-2 py-1 text-sm bg-white"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="text-sm text-red-600" data-testid="text-error">
          Failed to load nudge stats
        </p>
      )}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.triggers.map((t) => (
            <Card key={t.trigger} data-testid={`card-nudge-${t.trigger}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  {TRIGGER_LABELS[t.trigger] ?? t.trigger}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Impressions</span>
                  <span
                    className="font-medium"
                    data-testid={`stat-${t.trigger}-impressions`}
                  >
                    {t.impressions}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Clicks</span>
                  <span
                    className="font-medium"
                    data-testid={`stat-${t.trigger}-clicks`}
                  >
                    {t.clicks}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Conversions</span>
                  <span
                    className="font-medium"
                    data-testid={`stat-${t.trigger}-conversions`}
                  >
                    {t.conversions}
                  </span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between text-sm">
                  <span className="text-slate-500">CTR</span>
                  <span className="font-medium">
                    {pct(t.clicks, t.impressions)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Click → signup</span>
                  <span className="font-medium">
                    {pct(t.conversions, t.clicks)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
