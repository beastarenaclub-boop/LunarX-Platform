import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  ApiError,
  getGetMeQueryKey,
  useLogin,
  useSignup,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSiteChannel } from "@/lib/siteChannel";
import { announceNewUsername } from "@/components/auth/NewUsernameDialog";
import { B2C_BRAND } from "./config";

export function B2CAuthDialog({
  open,
  onOpenChange,
  destination,
  onBrowse,
  demoPending = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  destination: string;
  onBrowse: () => void;
  demoPending?: boolean;
}) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const site = useSiteChannel();
  const [signup, setSignup] = useState(false);
  const [visible, setVisible] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const login = useLogin();
  const register = useSignup();
  const pending = login.isPending || register.isPending;
  const canSignup = site.data?.signupEnabled === true;
  const registering = signup && canSignup;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || pending) return;
    setError("");
    try {
      const response = registering
        ? await register.mutateAsync({
            data: {
              password,
              displayName: name.trim() || undefined,
            },
          })
        : await login.mutateAsync({
            data: { username: username.trim().toLowerCase(), password },
          });
      // Show the generated username (app-root dialog) before the form closes.
      if (registering)
        announceNewUsername(response.username ?? response.user.username);
      qc.setQueryData(getGetMeQueryKey(), response.user);
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setPassword("");
      setSignup(false);
      onOpenChange(false);
      navigate(destination);
    } catch (cause) {
      const data =
        cause instanceof ApiError
          ? (cause.data as { error?: { message?: unknown } } | null)
          : null;
      const message = data?.error?.message;
      setError(
        typeof message === "string"
          ? message
          : "Unable to connect. Please try again in a moment.",
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          onOpenChange(value);
          setError("");
          setPassword("");
        }
      }}
    >
      <DialogContent className="b2c-modal b2c-auth-modal">
        <div className="b2c-modal-heading">
          <LockKeyhole size={19} />
          <DialogTitle>{registering ? "Create account" : "Login"}</DialogTitle>
        </div>
        <DialogDescription className="b2c-auth-intro">
          {site.data?.channel === "b2b" ? (
            <>Welcome to <strong>{B2C_BRAND}</strong>. Sign in with the player account supplied by your agent. Contact your agent for an account.</>
          ) : (
            <>Welcome to <strong>{B2C_BRAND}</strong>. Your next game is waiting.</>
          )}
        </DialogDescription>
        <form onSubmit={submit} className="b2c-auth-form">
          {registering && (
            <label>
              Name
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={50}
              />
            </label>
          )}
          {registering ? (
            <p className="b2c-username-hint">
              Your username is the first 5 letters of your name + 3 random
              numbers (like <strong>rahul482</strong>).
            </p>
          ) : (
            <label>
              Username
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={254}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. rahul482"
                data-testid="input-login-username"
              />
            </label>
          )}
          <label>
            Password
            <span className="b2c-password">
              <input
                type={visible ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 8 : undefined}
                maxLength={registering ? 72 : 128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
              <button
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          {registering && (
            <p className="b2c-username-hint">
              At least 8 characters with a letter and a number.
            </p>
          )}
          {!registering && (
            <button
              type="button"
              className="b2c-forgot"
              onClick={() => navigate("/forgot")}
            >
              Forgot password?
            </button>
          )}
          <label className="b2c-age-check">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              I am at least <strong>18 years old</strong>. I understand that
              games involve financial risk and agree to play responsibly.
            </span>
          </label>
          {error && (
            <p className="b2c-form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="b2c-button b2c-primary"
            disabled={pending || !accepted}
          >
            {pending
              ? "Please wait…"
              : registering
                ? "Create account"
                : "Login"}
          </button>
          {canSignup && (
            <p className="b2c-auth-switch">
              {registering ? "Already have an account?" : "New here?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setSignup(!signup);
                  setError("");
                }}
              >
                {registering ? "Login" : "Create an account"}
              </button>
            </p>
          )}
        </form>
        <p className="b2c-auth-intro text-xs">For account security, we record your IP address, approximate IP location and browser/device details. Exact GPS location is not collected.</p>
        {site.data?.channel === "b2c" && <>
        <div className="b2c-or">
          <span />
          or
          <span />
        </div>
        <button
          className="b2c-button b2c-secondary"
          disabled={pending || demoPending}
          onClick={onBrowse}
        >
          {demoPending ? "Starting demo…" : "Play Demo"}
        </button>
        <p className="b2c-auth-note">
          <ShieldCheck size={14} /> Play for 1 hour with unlimited demo coins.
          No signup. Demo winnings cannot be withdrawn.
        </p>
        </>}
      </DialogContent>
    </Dialog>
  );
}
