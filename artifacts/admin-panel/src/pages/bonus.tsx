import { useState } from "react";
import { useAdminIssueBonus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paiseToINR } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

export default function BonusPage() {
  const { user } = useAuth();
  const canIssue = hasRole(user, "admin", "super_admin");
  const [kind, setKind] = useState<"user" | "segment">("user");
  const [userId, setUserId] = useState("");
  const [segment, setSegment] = useState("new_last_7_days");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [wagering, setWagering] = useState("");
  const issue = useAdminIssueBonus();

  if (!canIssue) {
    return (
      <p className="text-sm text-slate-500">
        Only admins can issue bonuses.
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Bonus issuance</h1>
        <p className="text-sm text-slate-500">
          Credit a single user or a segment of active users.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New bonus</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Target</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "user" | "segment")}
            >
              <SelectTrigger data-testid="select-target-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Single user</SelectItem>
                <SelectItem value="segment">Segment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "user" ? (
            <div className="space-y-1">
              <Label htmlFor="uid">User ID</Label>
              <Input
                id="uid"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                data-testid="input-bonus-user"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Segment</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger data-testid="select-segment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_last_7_days">
                    New users (last 7 days)
                  </SelectItem>
                  <SelectItem value="new_last_30_days">
                    New users (last 30 days)
                  </SelectItem>
                  <SelectItem value="all_active">All active users</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="amt">Amount per user (paise)</Label>
            <Input
              id="amt"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 10000 = ₹100.00"
              data-testid="input-bonus-amount"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="memo">Memo</Label>
            <Input
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Welcome bonus campaign #42"
              data-testid="input-bonus-memo"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wager">Wagering note (optional)</Label>
            <Input
              id="wager"
              value={wagering}
              onChange={(e) => setWagering(e.target.value)}
              placeholder="e.g. 5x wagering required"
              data-testid="input-bonus-wagering"
            />
          </div>
          <Button
            disabled={
              issue.isPending ||
              !amount ||
              !memo ||
              (kind === "user" && !userId)
            }
            data-testid="button-issue-bonus"
            onClick={() =>
              issue.mutate({
                data: {
                  amount,
                  memo,
                  wageringNote: wagering || undefined,
                  target:
                    kind === "user"
                      ? { kind: "user", userId }
                      : { kind: "segment", segment: segment as never },
                },
              })
            }
          >
            {issue.isPending ? "Issuing…" : "Issue bonus"}
          </Button>
          {issue.isSuccess && issue.data && (
            <p className="text-sm text-emerald-700" data-testid="text-bonus-result">
              Credited {issue.data.credited} user(s) for a total of{" "}
              {paiseToINR(issue.data.totalAmount)}.
            </p>
          )}
          {issue.isError && (
            <p className="text-sm text-red-600">
              {(issue.error as Error)?.message ?? "Failed to issue bonus"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
