import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ApiError, customFetch, disconnectRealtime } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { B2C_HOME } from "./config";
import "./demo.css";

export function DemoSessionBanner() {
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const [exiting, setExiting] = useState(false);
  const expiresAt = user?.demoExpiresAt ? Date.parse(user.demoExpiresAt) : 0;
  useEffect(() => {
    if (!user?.isDemo) return;
    let stopped = false;
    let leaving = false;
    let clock: { server: number; monotonic: number } | undefined;
    const expire = () => {
      if (leaving || stopped) return;
      leaving = true;
      disconnectRealtime();
      window.location.replace(`${B2C_HOME}?demo=expired`);
    };
    const heartbeat = async () => {
      if (document.hidden || stopped) return;
      try {
        const response = await customFetch<{ serverNow: number }>("/api/auth/demo-heartbeat", { method: "POST" });
        clock = { server: response.serverNow, monotonic: performance.now() };
        setNow(response.serverNow);
      }
      catch (error) { if (error instanceof ApiError && error.status === 401) expire(); }
    };
    const tick = setInterval(() => {
      const time = clock ? clock.server + performance.now() - clock.monotonic : Date.now(); setNow(time);
      if (clock && expiresAt && time >= expiresAt) expire();
    }, 1000);
    const pulse = setInterval(heartbeat, 20_000);
    const visible = () => { setNow(Date.now()); void heartbeat(); };
    document.addEventListener("visibilitychange", visible);
    void heartbeat();
    return () => { stopped = true; clearInterval(tick); clearInterval(pulse); document.removeEventListener("visibilitychange", visible); };
  }, [user?.id, user?.isDemo, expiresAt]);

  if (!user?.isDemo) return null;
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const remaining = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  async function exitDemo() {
    setExiting(true);
    try {
      await customFetch("/api/auth/logout", { method: "POST" });
      disconnectRealtime();
      window.location.assign(B2C_HOME);
    } catch { toast.error("Could not end demo. Please retry."); setExiting(false); }
  }
  return <div className="demo-session-banner" role="region" aria-label="Demo session">
    <span><strong>DEMO · ∞ coins</strong><small>{user.displayName} · Practice only · No withdrawals</small></span>
    <span className="demo-session-controls"><time aria-label="Demo time remaining">{remaining}</time>
      <button onClick={exitDemo} disabled={exiting}>{exiting ? "Ending…" : "Exit Demo"}</button></span>
  </div>;
}

export function DemoWallet() {
  return <main className="demo-wallet">
    <strong className="demo-wallet-coins">∞</strong>
    <h1>Unlimited demo coins</h1>
    <p>Play any available game and try placing bets. Your demo coins automatically refill.</p>
    <p>Demo wins have no cash value. Deposits, withdrawals and transfers are disabled.</p>
    <Link href={B2C_HOME}>Back to games</Link>
  </main>;
}
