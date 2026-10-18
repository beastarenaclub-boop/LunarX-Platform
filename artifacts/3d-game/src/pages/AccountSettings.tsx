import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  disconnectRealtime,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ACCOUNT_OPTIONS } from "@/components/site/AccountOptions";
import {
  DEFAULT_BUTTON_VALUES,
  saveButtonValues,
  useButtonValues,
} from "@/lib/buttonValues";
import { useAuth } from "@/lib/auth";
import { accountDate } from "./AccountReport";

const post = <T,>(path: string, data: unknown) =>
  customFetch<T>(`/api/profile/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function ButtonValues() {
  const { user } = useAuth();
  const saved = useButtonValues();
  const [values, setValues] = useState(() =>
    (saved || DEFAULT_BUTTON_VALUES).map(String),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const numbers = values.map(Number);
      saveButtonValues(user!.id, numbers);
      setValues(numbers.sort((a, b) => a - b).map(String));
      setMessage("Button values saved on this browser.");
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <form className="account-form" onSubmit={save}>
      <h2>Your quick-bet amounts</h2>
      <p>
        Choose six different amounts in rupees for cash games that support
        custom stakes. Game-specific stake limits still apply. Saving these
        settings does not place a bet; in-game selections follow each game's
        betting controls.
      </p>
      <div className="account-values">
        {values.map((value, index) => (
          <label key={index}>
            Button {index + 1} (₹)
            <input
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={1000000}
              step={1}
              value={value}
              onChange={(e) => {
                setValues((old) =>
                  old.map((v, i) => (i === index ? e.target.value : v)),
                );
                setMessage("");
              }}
            />
          </label>
        ))}
      </div>
      <p className="account-hint">
        Saved for your account on this browser. Other devices keep their own
        settings.
      </p>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="account-success">
          <CheckCircle2 size={17} />
          {message}
        </p>
      )}
      <div className="account-actions">
        <button className="account-primary" type="submit">
          Save button values
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              saveButtonValues(user!.id, null);
              setValues(DEFAULT_BUTTON_VALUES.map(String));
              setError("");
              setMessage("Default values restored.");
            } catch {
              setError("Browser storage is unavailable.");
            }
          }}
        >
          Restore defaults
        </button>
      </div>
    </form>
  );
}
function ChangePassword() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: () =>
      post("password", { currentPassword, newPassword, confirmPassword }),
    onSuccess: async () => {
      setCurrent("");
      setNew("");
      setConfirm("");
      disconnectRealtime();
      await qc.cancelQueries();
      qc.clear();
      qc.setQueryData(getGetMeQueryKey(), null);
      toast.success("Password changed. Sign in with your new password.");
      navigate("/login");
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a different new password.");
      return;
    }
    change.mutate();
  }
  return (
    <form className="account-form account-form-narrow" onSubmit={submit}>
      <h2>Update your password</h2>
      <p>
        Use at least 8 characters. Changing your password signs you out on all
        devices, including this one.
      </p>
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          value={confirmPassword}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {(error || change.isError) && (
        <p role="alert" className="account-error">
          {error || errorText(change.error)}
        </p>
      )}
      <button
        className="account-primary"
        disabled={change.isPending}
        type="submit"
      >
        {change.isPending ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}
type Session = {
  current: boolean;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  device: string | null;
};
function Security() {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const security = useQuery({
    queryKey: ["account-security", user?.id],
    queryFn: ({ signal }) =>
      customFetch<{ sessions: Session[] }>("/api/profile/security", { signal }),
    retry: false,
  });
  const action = useMutation({
    mutationFn: (kind: "verify" | "revoke-others") =>
      post(`security/${kind}`, { currentPassword: password }),
    onSuccess: (_, kind) => {
      setPassword("");
      setMessage(
        kind === "verify"
          ? "Your current password was verified successfully."
          : "Other devices have been signed out. This session remains active.",
      );
      void security.refetch();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    action.mutate("verify");
  }
  return (
    <div className="account-security">
      <form className="account-form" onSubmit={submit}>
        <h2>
          <ShieldCheck size={22} /> Verify your account access
        </h2>
        <p>
          Confirm your current password to check account access or sign out
          other devices. This is password verification; authenticator-based
          two-step verification is not currently available.
        </p>
        <p className="account-hint">
          Account: {user?.email} · Status: {user?.status} ·{" "}
          <Link href="/profile">View identity verification</Link>
        </p>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setMessage("");
            }}
          />
        </label>
        {action.isError && (
          <p className="account-error" role="alert">
            {errorText(action.error)}
          </p>
        )}
        {message && (
          <p className="account-success" role="status">
            <CheckCircle2 size={17} />
            {message}
          </p>
        )}
        <div className="account-actions">
          <button
            type="submit"
            className="account-primary"
            disabled={action.isPending}
          >
            Verify password
          </button>
          <button
            type="button"
            disabled={!password || action.isPending}
            onClick={() => {
              setMessage("");
              action.mutate("revoke-others");
            }}
          >
            Sign out other devices
          </button>
        </div>
      </form>
      <section className="account-panel">
        <div className="account-section-heading">
          <h2>Active sessions</h2>
          <button
            disabled={security.isFetching}
            onClick={() => void security.refetch()}
          >
            Refresh
          </button>
        </div>
        {security.isPending && <p role="status">Loading sessions…</p>}
        {security.isError && (
          <p role="alert" className="account-error">
            Could not load sessions. Use Refresh to try again.
          </p>
        )}
        {security.data?.sessions.map((session, i) => (
          <article
            className="account-session"
            key={`${session.createdAt}-${i}`}
          >
            <strong>{session.current ? "This device" : "Other device"}</strong>
            <p>{session.device || "Browser details unavailable"}</p>
            <small>
              IP: {session.ip || "Unavailable"} · Signed in{" "}
              {accountDate(session.createdAt)} · Expires{" "}
              {accountDate(session.expiresAt)}
            </small>
          </article>
        ))}
      </section>
    </div>
  );
}
export default function AccountSettings({ kind }: { kind: string }) {
  const option = ACCOUNT_OPTIONS.find((o) => o.href === `/settings/${kind}`)!;
  return (
    <SiteLayout title={option.label} description={option.description}>
      <Link href="/profile" className="account-back">
        ← Profile options
      </Link>
      {kind === "buttonvalue" ? (
        <ButtonValues />
      ) : kind === "changepassword" ? (
        <ChangePassword />
      ) : (
        <Security />
      )}
    </SiteLayout>
  );
}
