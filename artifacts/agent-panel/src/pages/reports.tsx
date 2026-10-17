import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Users, Coins } from "lucide-react";

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const downloadCsv = (type: "players" | "commissions") => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const url = `/api/agent/reports/${type}/csv?${params.toString()}`;
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Download CSV reports for your referred players and commissions
        </p>
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-sm text-muted-foreground">From</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">To</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">Player Activity Report</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Export all your referred players with their signup dates, KYC status,
              lifetime deposits, bets, and net revenue figures.
            </p>
            <Button onClick={() => downloadCsv("players")} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Download Players CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">Commission Earnings Report</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Export your commission ledger with daily breakdowns per player,
              including gross stake, payout, net revenue, and commission earned.
            </p>
            <Button onClick={() => downloadCsv("commissions")} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Download Commissions CSV
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
