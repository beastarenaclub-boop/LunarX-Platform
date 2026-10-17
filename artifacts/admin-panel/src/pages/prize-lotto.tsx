import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  REWARDS,
  type PrizeAdminState,
  type PrizeSettings,
  type PrizeTicket,
  type PrizeDelivery,
} from "../../../../lib/api-zod/src/prize-lotto";
import { useAuth, hasRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
const money = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR" });
const date = (n: number) =>
  new Date(n).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
export default function PrizeLottoAdmin() {
  const { user } = useAuth(),
    qc = useQueryClient(),
    canEdit = hasRole(user, "admin", "super_admin");
  const [page, setPage] = useState(1),
    [claims, setClaims] = useState(false);
  const [edit, setEdit] = useState<{
    version: number;
    settings: PrizeSettings;
  } | null>(null);
  const [ticket, setTicket] = useState<PrizeTicket | null>(null),
    [password, setPassword] = useState("");
  const [delivery, setDelivery] = useState<PrizeDelivery>({
    merchant: "",
    code: "",
    instructions: "",
    expiresAt: "",
  });
  const state = useQuery({
    queryKey: ["admin-prize-lotto", page, claims],
    queryFn: () =>
      customFetch<PrizeAdminState>(
        `/api/prize-lotto/admin?page=${page}&claims=${claims}`,
      ),
    refetchInterval: 5000,
  });
  const save = useMutation({
    mutationFn: () =>
      customFetch(
        ticket
          ? `/api/prize-lotto/admin/tickets/${ticket.id}/fulfill`
          : "/api/prize-lotto/admin/settings",
        {
          method: ticket ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Confirm-Password": password,
          },
          body: JSON.stringify(ticket ? delivery : edit),
        },
      ),
    onSuccess: async () => {
      setTicket(null);
      setEdit(null);
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["admin-prize-lotto"] });
    },
  });
  if (!state.data)
    return (
      <div role="status">
        {state.isError ? (
          <>
            <p>Unable to load Prize Lotto.</p>
            <Button onClick={() => void state.refetch()}>Retry</Button>
          </>
        ) : (
          "Loading Prize Lotto…"
        )}
      </div>
    );
  const data = state.data;
  return (
    <div className="space-y-6" data-testid="admin-prize-lotto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Prize Lotto</h1>
          <p className="text-sm text-slate-500">
            Reward draws, shared wallet and voucher fulfilment. All times IST.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              save.reset();
              setPassword("");
              setEdit({
                version: data.version,
                settings: { ...data.settings },
              });
            }}
          >
            Game settings
          </Button>
        )}
      </div>
      {state.isError && (
        <p role="alert" className="text-red-600">
          Connection lost. Refresh before making changes.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["Net ticket sales", money(data.totals.sales)],
          ["Reward value awarded", money(data.totals.prizes)],
          ["Cashback credited", money(data.totals.cashback)],
          ["Outstanding vouchers", money(data.totals.voucherLiability)],
          [
            "Sales less reward value",
            money(data.totals.sales - data.totals.prizes),
          ],
          ["Requested claims", data.totals.pendingClaims],
          ["Refunds", money(data.totals.refunds)],
          ["New-draw reward RTP", `${data.settings.rtp}%`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <strong className="text-xl">{value}</strong>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="font-semibold">
            {data.settings.salesEnabled ? "Sales open" : "Sales paused"} · 10×
            reward value
          </h2>
          <p className="text-sm text-slate-600">
            New draws: {data.settings.intervalSeconds} seconds ·{" "}
            {data.settings.rtp / 10}% win chance per selection ·{" "}
            {100 - data.settings.rtp}% theoretical margin. Outcomes are
            independent of stakes. RTP includes voucher face value; it is not a
            cash-only return or a profit guarantee.
          </p>
          <p className="text-sm text-slate-600">
            Maximum ticket {money(data.settings.maxTicket)}. Maximum payout
            exposure per reward per draw {money(data.settings.maxLiability)}.
            New tickets are rejected when full.
          </p>
          <p className="text-sm text-amber-700">
            Supply valid vouchers for the full award value. No external voucher
            provider is connected. Sales less reward value excludes fees,
            provider costs and pending draws; it is not accounting profit.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Tickets & reward claims</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={claims}
                onChange={(e) => {
                  setClaims(e.target.checked);
                  setPage(1);
                }}
              />
              Unfulfilled vouchers only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    "Ticket / player",
                    "Reward",
                    "Ticket value",
                    "Prize value",
                    "Status",
                    "Delivery",
                    "",
                  ].map((v) => (
                    <th key={v} className="p-3 font-medium">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="p-3">
                      <div className="font-mono text-xs">{t.id}</div>
                      <small>
                        {t.userId}
                        <br />
                        {date(t.created)}
                      </small>
                    </td>
                    <td className="p-3">
                      {REWARDS.find((r) => r.id === t.reward)?.name}
                    </td>
                    <td className="p-3">{money(t.amount)}</td>
                    <td className="p-3">{money(t.prize)}</td>
                    <td className="p-3">{t.status}</td>
                    <td className="p-3">{t.claimStatus}</td>
                    <td className="p-3">
                      {canEdit && t.claimStatus === "requested" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setTicket(t);
                            setPassword("");
                            save.reset();
                            setDelivery({
                              merchant: "",
                              code: "",
                              instructions: "",
                              expiresAt: "",
                            });
                          }}
                        >
                          Fulfil voucher
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.tickets.length && (
            <p className="p-8 text-center text-slate-500">
              No matching tickets.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-4">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>
              {data.page} / {data.pages}
            </span>
            <Button
              variant="outline"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="font-semibold">Draws & published rules</h2>
          {data.draws.map((d) => (
            <details key={d.id} className="rounded border p-3">
              <summary className="cursor-pointer text-sm">
                {date(d.ends)} ·{" "}
                {d.status === "settled"
                  ? (REWARDS.find((r) => r.id === d.result)?.name ?? "No prize")
                  : "Upcoming"}{" "}
                · {d.config.rtp}% RTP
              </summary>
              <div className="mt-3 break-all text-xs text-slate-500">
                {d.id}
                <br />
                Sales close {date(d.closes)}
                <br />
                Commitment: {d.commitment}
                {d.seed && (
                  <>
                    <br />
                    Seed: {d.seed}
                  </>
                )}
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
      <Dialog
        open={!!edit || !!ticket}
        onOpenChange={(open) => {
          if (!open && !save.isPending) {
            setEdit(null);
            setTicket(null);
            setPassword("");
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogTitle>
            {ticket ? "Deliver reward voucher" : "Prize Lotto settings"}
          </DialogTitle>
          <DialogDescription>
            {ticket
              ? `${ticket.id} · ${money(ticket.prize)} full face value. Only the ticket owner can see the delivered code.`
              : "RTP and interval changes affect newly scheduled draws. Existing draws keep their rules. Sales pause and stricter admission limits take effect immediately."}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {edit && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={edit.settings.salesEnabled}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        settings: {
                          ...edit.settings,
                          salesEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Accept ticket sales
                </label>
                {(
                  [
                    ["rtp", "Reward RTP (%)", 50, 95],
                    ["intervalSeconds", "Draw interval (seconds)", 30, 900],
                    ["maxTicket", "Maximum ticket (₹)", 100, 20000],
                    [
                      "maxLiability",
                      "Maximum reward liability per draw (₹)",
                      1000,
                      1000000,
                    ],
                  ] as const
                ).map(([field, label, min, max]) => (
                  <label key={field} className="block text-sm">
                    {label}
                    <Input
                      required
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      value={edit.settings[field]}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          settings: {
                            ...edit.settings,
                            [field]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </>
            )}
            {ticket && (
              <>
                <label className="block text-sm">
                  Merchant / issuer
                  <Input
                    required
                    maxLength={100}
                    minLength={2}
                    value={delivery.merchant}
                    onChange={(e) =>
                      setDelivery({ ...delivery, merchant: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Voucher code
                  <Input
                    required
                    minLength={3}
                    maxLength={300}
                    autoComplete="off"
                    value={delivery.code}
                    onChange={(e) =>
                      setDelivery({ ...delivery, code: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Redemption instructions
                  <textarea
                    required
                    minLength={5}
                    maxLength={1500}
                    className="mt-1 block min-h-24 w-full rounded border p-2"
                    value={delivery.instructions}
                    onChange={(e) =>
                      setDelivery({ ...delivery, instructions: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Expiry date (end of day, IST)
                  <Input
                    required
                    type="date"
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        expiresAt: e.target.value
                          ? new Date(
                              `${e.target.value}T23:59:59+05:30`,
                            ).toISOString()
                          : "",
                      })
                    }
                  />
                </label>
              </>
            )}
            <label className="block text-sm">
              Confirm admin password
              <Input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {save.isError && (
              <p role="alert" className="text-sm text-red-600">
                {save.error.message}
              </p>
            )}
            <Button type="submit" disabled={save.isPending || state.isError}>
              {save.isPending
                ? "Saving…"
                : ticket
                  ? "Deliver voucher"
                  : "Save settings"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
