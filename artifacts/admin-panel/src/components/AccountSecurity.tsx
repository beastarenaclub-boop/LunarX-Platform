import { useState } from "react";
import {
  customFetch,
  getAdminGetUserAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { paiseToINR } from "@/lib/format";
type Target = { id: string; email: string; role: string };
type Preview = {
  user: Target & { status: string };
  balance: string;
  branch: { name: string; kind: string } | null;
  entries: { type: string; amount: string; created_at: string }[];
  mode: "read_only";
  viewedAt: string;
};
export function AccountSecurity({ target }: { target: Target }) {
  const { user: actor } = useAuth(),
    qc = useQueryClient();
  const [mode, setMode] = useState<"password" | "support-view" | null>(null),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [adminPassword, setAdminPassword] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null);
  if (!actor || !["admin", "super_admin"].includes(actor.role)) return null;
  const allowed =
    actor.role === "super_admin" ||
    actor.id === target.id ||
    !["admin", "super_admin"].includes(target.role);
  function close() {
    setMode(null);
    setPassword("");
    setConfirm("");
    setAdminPassword("");
    setReason("");
    setError("");
    setPreview(null);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (mode === "password" && password !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const data = await customFetch<
        Preview & { self?: boolean; revokedSessions?: number }
      >(`/api/admin/users/${encodeURIComponent(target.id)}/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Confirm-Password": adminPassword,
        },
        body: JSON.stringify({
          reason,
          ...(mode === "password" ? { newPassword: password } : {}),
        }),
      });
      setAdminPassword("");
      setPassword("");
      setConfirm("");
      void qc.invalidateQueries({
        queryKey: getAdminGetUserAuditQueryKey(target.id),
      });
      void qc.invalidateQueries({ queryKey: ["account-access"] });
      if (mode === "password") {
        close();
        setNotice(
          `Password changed. ${data.revokedSessions ?? 0} existing sessions revoked.`,
        );
        if (data.self) window.location.assign(import.meta.env.BASE_URL);
      } else setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card aria-label="Account security controls">
      <CardHeader>
        <CardTitle>Account security & support</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!allowed}
            onClick={() => {
              close();
              setMode("password");
            }}
          >
            Change password
          </Button>
          <Button
            variant="outline"
            disabled={!allowed}
            onClick={() => {
              close();
              setMode("support-view");
            }}
          >
            View account (read-only)
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Password changes sign out existing sessions and invalidate reset
          links. Account previews keep your admin identity and are recorded in
          the audit log.
        </p>
        {!allowed && (
          <p className="text-sm">
            A super admin is required to manage another administrator.
          </p>
        )}
        {notice && (
          <p role="status" className="text-green-700">
            {notice}
          </p>
        )}
        <Dialog
          open={!!mode}
          onOpenChange={(open) => {
            if (!open && !busy) close();
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {preview
                  ? "Read-only account preview"
                  : mode === "password"
                    ? "Change account password"
                    : "Open account preview"}
              </DialogTitle>
              <DialogDescription>
                {target.email} · Your action is audited.
              </DialogDescription>
            </DialogHeader>
            {preview ? (
              <div className="space-y-4" aria-label="Read-only account preview">
                <p className="p-3 rounded bg-amber-50 text-amber-900">
                  Read-only support view. You remain signed in as the
                  administrator. No customer login session is created.
                </p>
                <p>
                  <strong>{preview.user.email}</strong>
                  <br />
                  {preview.branch?.kind ?? preview.user.role} ·{" "}
                  {preview.user.status}
                </p>
                {preview.branch && <p>Branch: {preview.branch.name}</p>}
                <p>Recorded wallet balance: {paiseToINR(preview.balance)}</p>
                <h3 className="font-semibold">Recent wallet entries</h3>
                {preview.entries.length ? (
                  preview.entries.map((r, i) => (
                    <p key={i}>
                      {r.type} · {paiseToINR(r.amount)}
                    </p>
                  ))
                ) : (
                  <p>No wallet entries.</p>
                )}
                <Button onClick={close}>Close preview</Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(e) => void submit(e)}>
                <label className="block text-sm">
                  Reason
                  <Input
                    aria-label="Security action reason"
                    required
                    minLength={5}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  Your admin password
                  <Input
                    aria-label="Your admin password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                </label>
                {mode === "password" && (
                  <>
                    <label className="block text-sm">
                      New account password
                      <Input
                        aria-label="New account password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={72}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Confirm new password
                      <Input
                        aria-label="Confirm new password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </label>
                    <p className="text-xs text-slate-500">
                      Use at least 12 characters, up to 72 UTF-8 bytes. Existing
                      passwords cannot be displayed.
                    </p>
                  </>
                )}
                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Working…"
                    : mode === "password"
                      ? "Reset password and sign out sessions"
                      : "Open read-only preview"}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
