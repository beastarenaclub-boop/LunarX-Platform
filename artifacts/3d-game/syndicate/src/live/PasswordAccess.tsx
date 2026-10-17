"use client";
import Link from "./EntryLink";
import { useEffect, useState, type MouseEvent } from "react";
import { ArrowUpRight, KeyRound, ShieldCheck } from "lucide-react";
import { Emblem } from "../App";
import { PORTALS, portalLabel, portalPath, type Portal } from "./portals";
import { requestLoginLocation } from "./location";
import { LocationNotice } from "./LocationAccess";
import EntrySoundscape from "./EntrySoundscape";
import CyberBackdrop from "./CyberBackdrop";
import { playEntrySound } from "./entry-audio";
export default function PasswordAccess({
  done,
  initialMode = "login",
  portal,
}: {
  done: (recoveryCode?: string) => void;
  initialMode?: "login" | "signup";
  portal: Portal;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "recover">(
    portal === "member" ? initialMode : "login",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  function keepCurrentForm(
    event: MouseEvent<HTMLAnchorElement>,
    targetMode: "login" | "signup",
  ) {
    if (
      mode === targetMode &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
      event.preventDefault();
  }
  useEffect(() => {
    setQuery(location.search);
  }, []);
  useEffect(
    () =>
      setConnected(
        !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname),
      ),
    [],
  );
  return (
    <main
      className={`live-auth password-access portal-${portal}`}
      onClickCapture={(event) => {
        const target = event.target as Element;
        if (
          target.closest("a, button") &&
          !target.closest(".entry-sound-toggle")
        )
          playEntrySound("click");
      }}
    >
      <CyberBackdrop variant="login" />
      <EntrySoundscape scene="login" />
      <Emblem />
      <div className="eyebrow">
        ILLUMINATI SYNDICATE / {portal.toUpperCase()} ACCESS
      </div>
      <h1>
        {mode === "login"
          ? `${portalLabel(portal)} login.`
          : mode === "signup"
            ? `${portalLabel(portal)} signup.`
            : `Recover your ${portal} account.`}
      </h1>
      <p>
        {mode === "login"
          ? `Sign in to your ${portal} panel with your email and password.`
          : mode === "signup"
            ? "Join as a Syndicate member. Your verification and approval of both direct members unlock agent access on this same ID."
            : "Use the recovery code saved when you created your login."}
      </p>
      {portal === "agent" && (
        <p className="subtle-note">
          Agent signup nahi hota. Apni member ID se pehle verification aur
          left/right ke 2 approved members complete karein. Eligible hone par
          isi email se agent login milega.
        </p>
      )}
      {portal === "admin" && (
        <p className="subtle-note">
          Owner access only. Administrator account ka public signup nahi hai.
        </p>
      )}
      <div className="auth-mode-tabs">
        <Link
          className={mode === "login" ? "active" : ""}
          href={portalPath(portal, "login") + query}
          aria-current={mode === "login" ? "page" : undefined}
          onClick={(event) => keepCurrentForm(event, "login")}
        >
          Sign in
        </Link>
        {portal === "member" && (
          <Link
            className={mode === "signup" ? "active" : ""}
            href={portalPath(portal, "signup") + query}
            aria-current={mode === "signup" ? "page" : undefined}
            onClick={(event) => keepCurrentForm(event, "signup")}
          >
            Create account
          </Link>
        )}
      </div>
      <form
        className="panel form live-form-pad auth-form"
        key={mode}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          if (mode !== "login" && f.get("password") !== f.get("confirm")) {
            playEntrySound("error");
            setError("Passwords do not match.");
            setBusy(false);
            return;
          }
          try {
            if (f.get("locationConsent") !== "on")
              throw Error("Agree to share your location before continuing.");
            setLocating(true);
            const location = await requestLoginLocation();
            setLocating(false);
            const response = await fetch("/api/auth/" + mode, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...Object.fromEntries(f),
                portal,
                location,
              }),
            });
            const result = (await response.json()) as {
              error?: string;
              recoveryCode?: string;
            };
            if (!response.ok) throw Error(result.error || "Could not sign in.");
            playEntrySound("success");
            done(result.recoveryCode);
          } catch (e) {
            playEntrySound("error");
            setError((e as Error).message);
          } finally {
            setBusy(false);
            setLocating(false);
          }
        }}
      >
        {mode === "signup" && (
          <label>
            Your name
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </label>
        )}
        <label>
          Email address
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="username"
          />
        </label>
        {mode === "recover" && (
          <label>
            Recovery code
            <input
              name="recoveryCode"
              required
              minLength={64}
              maxLength={64}
              autoComplete="off"
            />
          </label>
        )}
        <label>
          {mode === "recover" ? "New password" : "Password"}
          <input
            type="password"
            name="password"
            required
            minLength={mode === "login" ? 1 : 12}
            maxLength={128}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
        </label>
        {mode !== "login" && (
          <>
            <label>
              Confirm password
              <input
                type="password"
                name="confirm"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <small>
              Use at least 12 characters. A recovery code will be shown once.
            </small>
          </>
        )}
        {mode === "signup" && (
          <p className="small muted">
            Step 1 of 2: create your login. Next, save your recovery code and
            complete your member referral profile. The administrator can review
            your progress and documents.
          </p>
        )}
        <LocationNotice />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy
            ? locating
              ? "Getting location…"
              : "Please wait…"
            : mode === "login"
              ? "Sign in to portal"
              : mode === "signup"
                ? "Create my login"
                : "Reset password"}
          <ArrowUpRight size={16} />
        </button>
      </form>
      <button
        className="link-button"
        onClick={() => {
          setMode("recover");
          setError("");
        }}
      >
        <KeyRound size={14} /> Forgot password? Use recovery code
      </button>
      {connected && (
        <a
          className="btn secondary"
          href="/signin-with-chatgpt?return_to=/"
          target="_top"
        >
          Continue with ChatGPT
        </a>
      )}
      <small>
        <ShieldCheck size={14} /> Roles and access are checked by the server.
      </small>
      <nav className="portal-switch" aria-label="Choose account portal">
        {PORTALS.filter((p) => p !== portal).map((p) => (
          <Link key={p} href={portalPath(p, "login")}>
            {portalLabel(p)} login
          </Link>
        ))}
        <Link href="/login">All panels</Link>
      </nav>
    </main>
  );
}
export function RecoveryCode({
  code,
  done,
}: {
  code: string;
  done: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <main className="live-auth password-access">
      <Emblem />
      <h1>Save your recovery code.</h1>
      <p>
        Keep this code somewhere private. It can reset your password without
        email delivery. Each password reset replaces it.
      </p>
      <label className="auth-form">
        Your recovery code
        <textarea
          aria-label="Your recovery code"
          readOnly
          value={code}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />{" "}
        I have saved my recovery code privately.
      </label>
      <button className="btn primary" disabled={!saved} onClick={done}>
        Continue to workspace <ArrowUpRight size={16} />
      </button>
    </main>
  );
}
