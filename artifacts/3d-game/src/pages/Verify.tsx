import { SiteLayout } from "@/components/site/SiteLayout";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deriveCrash, sha256Hex } from "@/game/rng";

const BASE = import.meta.env.VITE_API_URL || "/api";

interface VerifyResult {
  id: string;
  gameCode: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashPoint: number;
  computedCrashPoint: number;
  computedHash: string;
  hashMatch: boolean;
  crashMatch: boolean;
  verified: boolean;
  createdAt: string;
}

export default function VerifyPage() {
  const [roundId, setRoundId] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localResult, setLocalResult] = useState<{
    hash: string;
    crash: number;
    hashMatch: boolean;
    crashMatch: boolean;
  } | null>(null);

  const handleVerify = async () => {
    if (!roundId.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setLocalResult(null);
    try {
      const res = await fetch(
        `${BASE}/game/rounds/${encodeURIComponent(roundId.trim())}/verify`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Round not found");
      }
      const data: VerifyResult = await res.json();
      setResult(data);

      const localHash = await sha256Hex(data.serverSeed);
      const localCrash = await deriveCrash(
        data.serverSeed,
        data.clientSeed,
        data.nonce,
      );
      setLocalResult({
        hash: localHash,
        crash: localCrash,
        hashMatch: localHash === data.serverSeedHash,
        crashMatch: Math.abs(localCrash - data.crashPoint) < 0.005,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SiteLayout
      title="Round verifier"
      description="Look up a past crash round and check its result against the published seeds."
    >
      <div className="site-stack">
        <div className="bg-card border border-card-border rounded-lg p-6 space-y-4">
          <div>
            <Label
              htmlFor="verify-round-id"
              className="text-xs text-muted-foreground"
            >
              Round ID
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                className="bg-background border-input text-foreground font-mono"
                id="verify-round-id"
                placeholder="Enter round ID"
                value={roundId}
                onChange={(e) => setRoundId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              />
              <Button
                onClick={handleVerify}
                disabled={loading || !roundId.trim()}
              >
                {loading ? "Verifying..." : "Verify"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              <X className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div
                className={`flex items-center gap-2 p-3 rounded text-sm font-medium ${
                  result.verified
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                {result.verified ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <X className="w-5 h-5" />
                )}
                {result.verified
                  ? "Round verified - outcome is provably fair"
                  : "Verification failed - mismatch detected"}
              </div>

              <div className="space-y-3">
                <Field
                  label="Crash Point"
                  value={`${result.crashPoint.toFixed(2)}x`}
                />
                <Field label="Server Seed" value={result.serverSeed} mono />
                <Field
                  label="Server Seed Hash"
                  value={result.serverSeedHash}
                  mono
                />
                <Field label="Client Seed" value={result.clientSeed} mono />
                <Field label="Nonce" value={String(result.nonce)} />
                <Field
                  label="Created"
                  value={new Date(result.createdAt).toLocaleString()}
                />
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Server Verification
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <VerifyCheck label="Hash Match" ok={result.hashMatch} />
                  <VerifyCheck label="Crash Match" ok={result.crashMatch} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Computed crash: {result.computedCrashPoint.toFixed(2)}x
                </p>
              </div>

              {localResult && (
                <div className="border-t border-border pt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Client-Side Verification
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <VerifyCheck
                      label="Hash Match"
                      ok={localResult.hashMatch}
                    />
                    <VerifyCheck
                      label="Crash Match"
                      ok={localResult.crashMatch}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Local computed crash: {localResult.crash.toFixed(2)}x
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 bg-card border border-card-border rounded-lg p-6">
          <h2 className="font-semibold mb-2">How it works</h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              Before each round, the server generates a random seed and
              publishes its SHA-256 hash (commitment).
            </li>
            <li>
              The crash point is computed deterministically from the server
              seed, client seed, and nonce using a standard formula.
            </li>
            <li>
              After the round ends, the server seed is revealed so anyone can
              recompute the crash point and verify it matches.
            </li>
            <li>
              This page performs both server-side and client-side verification
              to confirm the outcome was not manipulated.
            </li>
          </ol>
        </div>
      </div>
    </SiteLayout>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-sm break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function VerifyCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 p-2 rounded ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      }`}
    >
      {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      {label}
    </div>
  );
}
