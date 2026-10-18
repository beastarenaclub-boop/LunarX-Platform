import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Row = {
  id: string;
  userId: string;
  email: string;
  role: string;
  loginAt: string;
  lastSeenAt: string | null;
  loginIp: string | null;
  ip: string | null;
  ipSource: string;
  status: string;
  device: {
    type: string;
    browser: string;
    version: string;
    os: string;
    osVersion: string;
    model: string | null;
    userAgent: string;
  };
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
    status: string;
    databaseMonth: string;
  };
};
const time = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";
function dates(period: string) {
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10),
    day = new Date(today + "T00:00:00Z");
  if (period === "all") return { from: "", to: "" };
  if (period === "yesterday") day.setUTCDate(day.getUTCDate() - 1);
  if (period === "weekly")
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  if (period === "monthly") day.setUTCDate(1);
  const from = day.toISOString().slice(0, 10);
  return { from, to: period === "yesterday" ? from : today };
}
export function AccountAccessHistory({ userId }: { userId?: string }) {
  const [instance] = useState(() => crypto.randomUUID()),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState("all");
  const [applied, setApplied] = useState({
      q: "",
      from: "",
      to: "",
      status: "all",
    }),
    [offset, setOffset] = useState(0);
  const params = new URLSearchParams({
    limit: "50",
    offset: String(offset),
    status: applied.status,
  });
  if (userId) params.set("userId", userId);
  for (const k of ["q", "from", "to"] as const)
    if (applied[k]) params.set(k, applied[k]);
  const result = useQuery({
    queryKey: ["account-access", instance, params.toString()],
    queryFn: ({ signal }) =>
      customFetch<{ items: Row[]; total: number }>(
        `/api/admin/access-history?${params}`,
        { signal },
      ),
    retry: false,
    gcTime: 0,
    refetchInterval: 30000,
  });
  return (
    <Card aria-label="Account login activity">
      <CardHeader>
        <CardTitle>Login & device activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 min-w-0">
        <p className="text-sm text-slate-600">
          Last 90 days. Times are in India time. A valid session does not mean
          the customer is currently playing. Last activity updates at most once
          a minute.
        </p>
        <p className="text-xs text-slate-500">
          Location is an approximate IP estimate; VPNs and mobile networks can
          place it elsewhere. Device details are browser-reported and may be
          reduced or unavailable.{" "}
          <a
            href="https://db-ip.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            IP Geolocation by DB-IP
          </a>{" "}
          (October 2026).
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ q, from, to, status });
            setOffset(0);
          }}
        >
          <div className="flex flex-wrap gap-2">
            {["all", "today", "yesterday", "weekly", "monthly"].map((p) => (
              <Button
                key={p}
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  const d = dates(p);
                  setFrom(d.from);
                  setTo(d.to);
                  setApplied({ q, status, ...d });
                  setOffset(0);
                }}
              >
                {p === "all" ? "Last 90 days" : p[0].toUpperCase() + p.slice(1)}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              Search email, IP or browser
              <Input
                aria-label="Search account activity"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={100}
              />
            </label>
            <label className="text-xs">
              From (IST)
              <Input
                aria-label="Activity from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-xs">
              To (IST)
              <Input
                aria-label="Activity to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Session status
              <select
                aria-label="Session status"
                className="border rounded-md h-9 w-full bg-white px-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All</option>
                <option value="recent">Seen in last 5 minutes</option>
                <option value="active">Valid session</option>
                <option value="revoked">Signed out / revoked</option>
                <option value="expired">Expired</option>
              </select>
            </label>
          </div>
          <Button type="submit">Apply activity filters</Button>
        </form>
        {result.isFetching && <p role="status">Loading login activity…</p>}
        {result.isError ? (
          <p role="alert" className="text-red-600">
            Activity could not be loaded. {result.error.message}{" "}
            <Button variant="outline" onClick={() => void result.refetch()}>
              Retry activity
            </Button>
          </p>
        ) : (
          result.data && (
            <>
              <p className="text-sm">{result.data.total} matching sessions</p>
              <div className="space-y-3">
                {result.data.items.map((r) => (
                  <article
                    key={r.id}
                    className="border rounded-lg p-4 text-sm break-words"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <Link
                        href={`/users/${encodeURIComponent(r.userId)}`}
                        className="font-semibold underline break-all"
                      >
                        {r.email}
                      </Link>
                      <span>
                        {r.role} ·{" "}
                        {r.status === "active" ? "Valid session" : r.status}
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                      <div>
                        <strong>IP address</strong>
                        <p>{r.ip ?? "Not recorded"}</p>
                        {r.ipSource === "legacy_login" && (
                          <p className="text-xs text-slate-500">
                            Legacy login IP; not independently verified
                          </p>
                        )}
                        {r.loginIp !== r.ip && (
                          <p className="text-xs">
                            At login: {r.loginIp ?? "Not recorded"}
                          </p>
                        )}
                      </div>
                      <div>
                        <strong>Approximate location</strong>
                        <p>
                          {[
                            r.location.city,
                            r.location.region,
                            r.location.country,
                          ]
                            .filter(Boolean)
                            .join(", ") || "Unavailable"}
                        </p>
                      </div>
                      <div>
                        <strong>Device / phone</strong>
                        <p>
                          {r.device.type} ·{" "}
                          {r.device.model ?? "Model not provided"}
                        </p>
                      </div>
                      <div>
                        <strong>Browser / OS</strong>
                        <p>
                          {r.device.browser} {r.device.version}
                        </p>
                        <p>
                          {r.device.os} {r.device.osVersion}
                        </p>
                      </div>
                      <div>
                        <strong>Logged in</strong>
                        <p>{time(r.loginAt)}</p>
                      </div>
                      <div>
                        <strong>Last activity</strong>
                        <p>{time(r.lastSeenAt)}</p>
                      </div>
                    </div>
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer">
                        Browser-reported details
                      </summary>
                      <p className="break-all mt-2">
                        {r.device.userAgent || "Not provided"}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
              {!result.data.items.length && (
                <p>No sessions match these filters.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!offset || result.isFetching}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous sessions
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    offset + 50 >= result.data.total || result.isFetching
                  }
                  onClick={() => setOffset(offset + 50)}
                >
                  Next sessions
                </Button>
              </div>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
