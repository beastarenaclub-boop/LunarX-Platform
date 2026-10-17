import { useEffect, useRef, useState } from "react";
import Mines from "@/pages/Mines";
import Plinko from "@/pages/Plinko";
import Dice from "@/pages/Dice";
import Roulette from "@/pages/Roulette";
import Baccarat from "@/pages/Baccarat";
import Blackjack from "@/pages/Blackjack";
import TeenPatti from "@/pages/TeenPatti";
import TeenPattiLive from "@/pages/TeenPattiLive";
import AndarBahar from "@/pages/AndarBahar";
import Lucky7 from "@/pages/Lucky7";
import {
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  addResponseObserver,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

const POST_TARGET = "*"; // wrapper at /launch is same-origin to us; partner runs in window.top

function emit(type: string, payload: Record<string, unknown> = {}) {
  try {
    window.parent?.postMessage(
      { source: "lunar", type: `lunar:${type}`, ts: Date.now(), ...payload },
      POST_TARGET,
    );
  } catch {
    // never throw from postMessage; partner may close the window
  }
}

/**
 * Wallet scopes the launcher can be asked for. Every game it dispatches keeps
 * its own wallet, so an unrecognised code falls back to the default scope
 * rather than sending the server something it will reject.
 */
const WALLET_SCOPES = [
  "lunar",
  "mines",
  "plinko",
  "dice",
  "roulette",
  "baccarat",
  "blackjack",
  "teen-patti",
  "teen-patti-live",
  "andar-bahar",
  "lucky-7",
] as const;

function walletScopeFor(code: string): (typeof WALLET_SCOPES)[number] {
  return (WALLET_SCOPES as readonly string[]).includes(code)
    ? (code as (typeof WALLET_SCOPES)[number])
    : "lunar";
}

function GameByCode({ code }: { code: string }) {
  switch (code) {
    case "mines":
      return <Mines />;
    case "plinko":
      return <Plinko />;
    case "dice":
      return <Dice />;
    case "roulette":
      return <Roulette />;
    case "baccarat":
      return <Baccarat />;
    case "blackjack":
      return <Blackjack />;
    case "teen-patti":
      return <TeenPatti />;
    case "teen-patti-live":
      return <TeenPattiLive />;
    case "andar-bahar":
      return <AndarBahar />;
    case "lucky-7":
      return <Lucky7 />;
    default:
      return (
        <div className="p-8 text-center text-red-400">
          Unknown game: {code}
        </div>
      );
  }
}

/**
 * Launcher entry rendered at /launcher. Exchanges the launch token from the
 * URL for an HTTP-only session cookie, then mounts the requested game with
 * all platform chrome (top bar, navigation, chat sidebar, signup nudges)
 * suppressed via a body-level CSS class. Bridges game store events out to
 * window.parent as lunar:* postMessages so the embedding partner can react
 * to bet placement, settlement, and balance changes.
 */
export default function Launcher() {
  // Capture the token EXACTLY once at mount via a useState initializer.
  // The /launch wrapper delivers the token via window.name (kept out of
  // the URL/history/Referer); we read it, then immediately clear it so
  // it doesn't leak to subsequent in-frame navigations. Storing in
  // useState makes it stable across re-renders so the exchange effect
  // doesn't rerun and flip into the missing-token error path.
  const [token] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const fromName = window.name || null;
    const fromQuery = new URL(window.location.href).searchParams.get("token");
    if (window.name) window.name = "";
    return fromName ?? fromQuery;
  });
  const [game] = useState<string>(
    () =>
      (typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("game")
        : null) ?? "",
  );

  const [status, setStatus] = useState<"exchanging" | "ready" | "error">(
    "exchanging",
  );
  const [error, setError] = useState<string | null>(null);
  const lastBalanceRef = useRef<string | null>(null);

  const { refresh } = useAuth();

  // 1. Token exchange — burns the single-use token and sets the sid cookie.
  useEffect(() => {
    if (game === "lunar" || game === "aviator") {
      setError("This game is no longer available.");
      setStatus("error");
      return;
    }
    if (!token) {
      setError("Missing token");
      setStatus("error");
      emit("error", { code: "MISSING_TOKEN", message: "Launch token missing" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/launcher/exchange`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        }
        await refresh();
        if (cancelled) return;
        setStatus("ready");
        document.body.classList.add("launcher-mode");
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).message;
        setError(msg);
        setStatus("error");
        emit("error", { code: "EXCHANGE_FAILED", message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refresh, game]);

  // 2. Wallet balance bridge — emits balanceChanged whenever the server-
  //    reported balance changes. We piggy-back on the existing react-query
  //    hook used by TopBar so it's already polling/invalidated by writes.
  //    Wallets are scoped per game, so this has to read the launched game's
  //    own wallet; lunar's balance is not the one the player can bet with.
  const walletScope = walletScopeFor(game);
  const balance = useGetWalletBalance(
    { game: walletScope },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: walletScope }),
        enabled: status === "ready",
        refetchInterval: 4000,
      },
    },
  );
  useEffect(() => {
    const b = balance.data?.balance;
    if (b == null) return;
    if (b === lastBalanceRef.current) return;
    lastBalanceRef.current = b;
    emit("balanceChanged", { balance: b, currency: "INR" });
  }, [balance.data?.balance]);

  // 3a. Game-agnostic bet lifecycle bridge — observes successful API
  //     responses at the fetch layer (works for lunar/mines/plinko/dice
  //     uniformly because they all go through @workspace/api-client-react).
  //     We emit on the response shape rather than per-game store state so
  //     the launcher contract holds for every shipping game.
  useEffect(() => {
    if (status !== "ready") return;
    const emitted = new Set<string>();
    const unsub = addResponseObserver((ev) => {
      try {
        if (ev.method !== "POST") return;
        // /api/bets/place response → betPlaced
        if (/\/api\/bets\/place(\?|$)/.test(ev.url)) {
          const d = ev.data as {
            id?: string;
            betId?: string;
            amount?: string | number;
            status?: string;
            multiplier?: string | number | null;
            payout?: string | number | null;
          };
          const id = d?.id ?? d?.betId;
          if (!id || emitted.has(`p:${id}`)) return;
          emitted.add(`p:${id}`);
          emit("betPlaced", {
            betId: id,
            gameCode: game,
            stakeAmount: d?.amount != null ? String(d.amount) : undefined,
          });
          // Some games (mines/plinko/dice) settle synchronously in the
          // place response — emit betSettled immediately when we see a
          // terminal status / payout in the same payload.
          if (
            d?.status &&
            (d.status === "won" || d.status === "lost" || d.status === "voided")
          ) {
            if (!emitted.has(`s:${id}`)) {
              emitted.add(`s:${id}`);
              emit("betSettled", {
                betId: id,
                gameCode: game,
                status: d.status,
                multiplier: d.multiplier ?? null,
                payoutAmount: d.payout != null ? String(d.payout) : "0",
              });
            }
          }
        }
        // /api/bets/:id/cashout response → betSettled (cashed_out)
        const m = ev.url.match(/\/api\/bets\/([^/?]+)\/cashout/);
        if (m) {
          const id = m[1];
          if (emitted.has(`s:${id}`)) return;
          emitted.add(`s:${id}`);
          const d = ev.data as {
            multiplier?: string | number | null;
            payout?: string | number | null;
          };
          emit("betSettled", {
            betId: id,
            gameCode: game,
            status: "cashed_out",
            multiplier: d?.multiplier ?? null,
            payoutAmount: d?.payout != null ? String(d.payout) : "0",
          });
        }
      } catch {
        // never throw from observers
      }
    });
    emit("gameLoaded", { gameCode: game });
    return () => unsub();
  }, [status, game]);

  if (status === "exchanging") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="animate-pulse text-lg">Loading game...</div>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-red-400 p-6">
        <div className="text-center max-w-md">
          <div className="text-xl font-semibold mb-2">Launch failed</div>
          <div className="text-sm text-red-300/80">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="launcher-container min-h-screen overflow-x-clip bg-background">
      <GameByCode code={game} />
    </div>
  );
}
