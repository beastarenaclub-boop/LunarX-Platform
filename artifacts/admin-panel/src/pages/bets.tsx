import { useState } from "react";
import { useAdminListBets } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { paiseToINR, fmtDate } from "@/lib/format";

const ALL = "__all";

export default function BetsPage() {
  const [userId, setUserId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading } = useAdminListBets({
    userId: userId || undefined,
    roundId: roundId || undefined,
    status: status !== ALL ? (status as never) : undefined,
    limit,
    offset: page * limit,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bets</h1>
        <p className="text-sm text-slate-500">Cross-user bet explorer</p>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <Input
          className="w-56"
          placeholder="User ID"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(0);
          }}
          data-testid="input-bets-user"
        />
        <Input
          className="w-56"
          placeholder="Round ID"
          value={roundId}
          onChange={(e) => {
            setRoundId(e.target.value);
            setPage(0);
          }}
          data-testid="input-bets-round"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40" data-testid="select-bets-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="placed">Placed</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
            <SelectItem value="cashed_out">Cashed out</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placed</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Game</TableHead>
              <TableHead>Round</TableHead>
              <TableHead>Stake</TableHead>
              <TableHead>Payout</TableHead>
              <TableHead>Mult</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data?.bets.map((b) => (
              <TableRow key={b.id} data-testid={`row-bet-${b.id}`}>
                <TableCell>{fmtDate(b.placedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{b.userId}</TableCell>
                <TableCell>{b.gameCode}</TableCell>
                <TableCell className="font-mono text-xs">
                  {b.roundId ?? "—"}
                </TableCell>
                <TableCell>{paiseToINR(b.stakeAmount)}</TableCell>
                <TableCell>{paiseToINR(b.payoutAmount)}</TableCell>
                <TableCell>{b.multiplier?.toFixed(2) ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{b.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.bets.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  No bets
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between text-sm text-slate-600">
        <span>{data ? `${data.total} total` : ""}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data || (page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
