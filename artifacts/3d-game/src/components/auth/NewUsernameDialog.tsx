import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { B2C_STANDALONE } from "@/components/b2c/config";

/**
 * After signup the server generates the player's username (first 5 letters of
 * their name + 3 digits, e.g. rahul482).
 * Signup forms call `announceNewUsername`; this dialog is mounted once at the
 * app root so it stays visible even when the signup form unmounts because
 * the player is now signed in.
 */
const KEY = "crypto777:new-username";
let current: string | null = (() => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

function set(value: string | null) {
  current = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

export function announceNewUsername(username: string | null | undefined) {
  if (username) set(username);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function NewUsernameDialog() {
  const username = useSyncExternalStore(subscribe, () => current, () => null);
  const [copied, setCopied] = useState(false);
  const b2c = B2C_STANDALONE || window.location.pathname.startsWith("/b2c");
  const close = () => {
    setCopied(false);
    set(null);
  };
  return (
    <Dialog open={!!username} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className={
          b2c
            ? "b2c-modal b2c-username-modal"
            : "max-w-sm"
        }
      >
        <div className={b2c ? "b2c-modal-heading" : "flex items-center gap-2"}>
          <ShieldCheck size={19} />
          <DialogTitle>Account created</DialogTitle>
        </div>
        <DialogDescription className={b2c ? "b2c-username-intro" : undefined}>
          This is your username. Save it — you need it with your password to
          login. It cannot be recovered by email.
        </DialogDescription>
        <div className="b2c-username-card" data-testid="text-new-username">
          <strong>{username}</strong>
          <button
            type="button"
            aria-label="Copy username"
            onClick={() => {
              if (!username) return;
              void navigator.clipboard?.writeText(username).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          className={
            b2c
              ? "b2c-button b2c-primary"
              : "w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
          }
          data-testid="btn-username-continue"
          onClick={close}
        >
          I saved it — continue
        </button>
      </DialogContent>
    </Dialog>
  );
}
