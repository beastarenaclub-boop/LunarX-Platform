import { useEffect, useRef, useState } from "react";

// The visible betting clock finishes before the server closes, leaving time
// for the request to travel. The server still validates the exact round.
export const BET_SEND_BUFFER_MS = 1200;

export function useChipDraft<T extends string>(roundKey: string | null, editable: boolean, balance: string, maxStake: string) {
  type Bet = { type: T; amountPaise: string };
  const [bets, setBets] = useState<Bet[]>([]);
  const current = useRef({ roundKey, bets });
  if (current.current.roundKey !== roundKey) current.current = { roundKey, bets: [] };
  const clear = () => { current.current.bets = []; setBets([]); };
  useEffect(clear, [roundKey]);
  const stage = (input: Bet[], replace = false) => {
    if (!editable) return false;
    const next = new Map<T, bigint>();
    for (const bet of [...(replace ? [] : current.current.bets), ...input]) {
      if (!/^\d+$/.test(bet.amountPaise) || BigInt(bet.amountPaise) <= 0n) return false;
      next.set(bet.type, (next.get(bet.type) ?? 0n) + BigInt(bet.amountPaise));
    }
    const total = [...next.values()].reduce((sum, n) => sum + n, 0n);
    if (total > BigInt(balance) || total > BigInt(maxStake)) return false;
    const result = [...next].map(([type, amount]) => ({ type, amountPaise: amount.toString() }));
    current.current.bets = result;
    setBets(result);
    return true;
  };
  return { bets: current.current.roundKey === roundKey ? current.current.bets : [], clear, stage };
}

export function useTimedBet(options: {
  roundKey: string | number | null;
  deadline: number | null;
  expiresAt: number | null;
  armed: boolean;
  enabled: boolean;
  submit: () => unknown;
}) {
  const latest = useRef(options);
  latest.current = options;
  const attempted = useRef<string | number | null>(null);
  useEffect(() => {
    const tick = () => {
      const o = latest.current;
      if (!o.armed || !o.enabled || o.roundKey == null || o.deadline == null ||
          o.expiresAt == null || attempted.current === o.roundKey) return;
      const now = Date.now();
      if (now < o.deadline) return;
      // A suspended tab or lost connection must never submit a late draft.
      attempted.current = o.roundKey;
      if (now >= o.expiresAt) return;
      void o.submit();
    };
    const timer = window.setInterval(tick, 50);
    return () => window.clearInterval(timer);
  }, []);
}

// Games without a shared round clock start a three-second selection window.
// Only an explicit player selection arms it; defaults and re-renders do not.
export function useSelectionBet(options: { enabled: boolean; submit: () => unknown; scope?: unknown }) {
  const latest = useRef(options);
  latest.current = options;
  const deadline = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const cancel = () => { deadline.current = null; setSeconds(null); };
  useEffect(() => { cancel(); }, [options.scope]);
  useEffect(() => {
    if (!options.enabled) cancel();
  }, [options.enabled]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (deadline.current == null) return;
      const left = deadline.current - Date.now();
      if (!latest.current.enabled || left < -1500) { cancel(); return; }
      if (left <= 0) {
        cancel(); // Disarm synchronously, before starting a request.
        void latest.current.submit();
      } else setSeconds(Math.ceil(left / 1000));
    }, 50);
    return () => window.clearInterval(timer);
  }, []);
  return {
    seconds,
    cancel,
    select: (enablesForm = false) => {
      // A selection may make the form valid in this same event (for example
      // choosing a horse). The timer rechecks the latest eligibility to spend.
      if (!latest.current.enabled && !enablesForm) return;
      deadline.current = Date.now() + 3000;
      setSeconds(3);
    },
  };
}

export function AutoBetStatus({ seconds, busy, selected, onCancel, className = "" }: {
  seconds?: number | null; busy?: boolean; selected?: boolean;
  onCancel?: () => void; className?: string;
}) {
  const armed = selected ?? seconds != null;
  return <div className={`auto-bet-status ${className}`} data-testid="auto-bet-status" role="status">
    <span>{busy ? "Placing bet…" : armed ? `Auto bet${seconds != null ? ` in ${Math.max(0, seconds)}s` : " at timer end"}` : "Select coins to bet"}</span>
    {armed && !busy && onCancel && <button type="button" onClick={onCancel} aria-label="Cancel selected bet">Cancel</button>}
  </div>;
}
