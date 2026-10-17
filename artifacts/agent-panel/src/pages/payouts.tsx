import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch, formatPaise } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Wallet } from "lucide-react";

type Payout = {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  method: string;
  destination: string;
  kind: string;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  requestedAt: string;
};

type AgentMe = {
  agent: {
    id: string;
    upiId: string | null;
    commissionRate: number;
  };
  stats: {
    availableBalance: string;
    pendingPayout: string;
  };
};

export default function PayoutsPage() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [upiId, setUpiId] = useState("");
  const [error, setError] = useState("");

  const { data: me } = useQuery({
    queryKey: ["agent-me"],
    queryFn: () => apiFetch<AgentMe>("/api/agent/me"),
  });

  const { data: payouts, isLoading } = useQuery({
    queryKey: ["agent-payouts"],
    queryFn: () => apiFetch<Payout[]>("/api/agent/payouts"),
  });

  const requestPayout = useMutation({
    mutationFn: (body: { amount: string; upiId: string }) =>
      apiFetch("/api/agent/payouts/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["agent-me"] });
      setOpen(false);
      setAmount("");
      setUpiId("");
      setError("");
    },
    onError: (err: Error) => {
      setError(err.message ?? "Request failed");
    },
  });

  const handleRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const rupees = parseFloat(amount);
    if (isNaN(rupees) || rupees <= 0) {
      setError("Enter a valid amount");
      return;
    }
    const paise = Math.round(rupees * 100).toString();
    requestPayout.mutate({ amount: paise, upiId: upiId || me?.agent.upiId || "" });
  };

  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (s) {
      case "approved":
      case "paid":
        return "default";
      case "pending":
        return "secondary";
      case "rejected":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payouts</h1>
          <p className="text-muted-foreground">
            Request commission payouts to your UPI account
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Wallet className="h-4 w-4 mr-2" />
              Request Payout
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Commission Payout</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRequest} className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {error}
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Available balance:{" "}
                  <span className="font-medium text-emerald-600">
                    {formatPaise(me?.stats.availableBalance ?? "0")}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Amount (INR)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="e.g. 500.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">UPI ID</label>
                <Input
                  type="text"
                  placeholder={me?.agent.upiId || "yourname@upi"}
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                />
                {me?.agent.upiId && !upiId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank to use saved: {me.agent.upiId}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={requestPayout.isPending}
              >
                {requestPayout.isPending ? "Requesting..." : "Submit Request"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>UPI ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !payouts?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No payout requests yet
                  </TableCell>
                </TableRow>
              ) : (
                payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {new Date(p.requestedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(p.amount)}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {p.destination}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(p.status)}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.rejectionReason ?? (p.reviewedAt ? "Reviewed" : "-")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
