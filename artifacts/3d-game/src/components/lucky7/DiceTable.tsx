import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import TableDice, { type TableDiceHandle } from "./TableDice";
import { DICE_FALLBACK_MS, DICE_FLIGHT_MS, TABLE_DICE_CONTACTS } from "./tableDiceMotion";
import DealerFilmStage, { type DealerRoll } from "./DealerFilmStage";
import { lucky7Dealer } from "./dealerCast";
import type { DiceAudio } from "./diceAudio";

interface Props {
  dice: [number, number] | null;
  roundId: string | null;
  settleAt: number | null;
  presentationEndsAt: number | null;
  audio?: DiceAudio;
  onSettled?: () => void;
  className?: string;
}
interface RollPlan {
  roundId: string; deadline: number; done: boolean; released: boolean; animated: boolean;
  dice: [number, number];
  nextImpact: number;
}

function DiceTable({ dice, roundId, settleAt, presentationEndsAt, audio, onSettled, className }: Props) {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [settledRound, setSettledRound] = useState<string | null>(null);
  const [motion, setMotion] = useState<"shake" | "roll" | "rest">("rest");
  const [fromHand, setFromHand] = useState(false);
  const [dealerRoll, setDealerRoll] = useState<DealerRoll | null>(null);
  const [presentedDice, setPresentedDice] = useState<[number, number] | null>(null);
  const tableDice = useRef<TableDiceHandle>(null);
  const callbacks = useRef({ audio, onSettled });
  callbacks.current = { audio, onSettled };
  const plan = useRef<RollPlan | null>(null);
  const landingTimer = useRef<number | undefined>(undefined);
  const guardTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  const finish = useCallback((current: RollPlan) => {
    if (plan.current !== current || current.done) return;
    current.done = true;
    window.clearTimeout(landingTimer.current); window.clearTimeout(guardTimer.current);
    setMotion("rest");
    setSettledRound(current.roundId);
    setPresentedDice(current.dice);
    if (current.animated) callbacks.current.audio?.onSettle?.();
    callbacks.current.onSettled?.();
  }, []);

  const release = useCallback((id: string, physical: boolean) => {
    const current = plan.current;
    if (!current || current.roundId !== id || current.done || current.released) return;
    current.released = true;
    const remaining = current.deadline - Date.now();
    const minimum = (physical ? DICE_FLIGHT_MS : DICE_FALLBACK_MS) + 80;
    if (document.hidden || remaining < minimum) { finish(current); return; }
    setFromHand(physical);
    setMotion("roll");
    callbacks.current.audio?.onThrow?.();
    // One decoded frame clock drives the handoff, tumble and landing.
    if (!physical) landingTimer.current = window.setTimeout(() => finish(current), DICE_FALLBACK_MS);
  }, [finish]);

  const land = useCallback((id: string) => {
    if (plan.current?.roundId === id) finish(plan.current);
  }, [finish]);
  const frame = useCallback((scene: "idle" | "action", ms: number) => tableDice.current?.frame(scene, ms), []);
  const progress = useCallback((fraction: number) => {
    const current = plan.current;
    if (!current || current.done || !current.released) return;
    while (current.nextImpact < TABLE_DICE_CONTACTS.length && fraction >= TABLE_DICE_CONTACTS[current.nextImpact].t) {
      const contact = TABLE_DICE_CONTACTS[current.nextImpact++];
      // Consume skipped frames silently; never replay a backlog after a stall.
      if (!document.hidden && (fraction - contact.t) * DICE_FLIGHT_MS < 100) {
        callbacks.current.audio?.onImpact?.(contact.strength);
      }
    }
  }, []);

  useEffect(() => {
    if (!dice || !roundId) return;
    const now = Date.now();
    if (plan.current?.roundId !== roundId) {
      window.clearTimeout(landingTimer.current); window.clearTimeout(guardTimer.current);
      const remaining = settleAt == null ? 0 : settleAt - now;
      const animated = !reduced && !document.hidden && remaining >= 1000;
      const current = { roundId, deadline: presentationEndsAt ?? settleAt ?? now, done: false, released: false, animated, nextImpact: 0, dice: [...dice] as [number, number] };
      plan.current = current;
      setMotion(animated ? "shake" : "rest");
      setFromHand(false);
      if (animated) {
        const request = { roundId, deadline: current.deadline };
        setDealerRoll(request);
        guardTimer.current = window.setTimeout(() => finish(current), Math.max(0, current.deadline - now - 100));
      } else { setDealerRoll(null); finish(current); }
    }
    const current = plan.current;
    if (current.done) return;
    // A financial settlement arriving during the roll must not snap the dice
    // to their result. Only a round change/closed window cancels presentation.
    if (reduced || presentationEndsAt == null) { setDealerRoll(null); finish(current); return; }
    if (presentationEndsAt < current.deadline) {
      current.deadline = presentationEndsAt;
      window.clearTimeout(guardTimer.current);
      guardTimer.current = window.setTimeout(() => finish(current), Math.max(0, current.deadline - now - 100));
    }
  }, [roundId, dice?.[0], dice?.[1], settleAt, presentationEndsAt, reduced, finish]);

  useEffect(() => {
    const resume = () => {
      const current = plan.current;
      if (current && !current.done && !document.hidden && Date.now() >= current.deadline) finish(current);
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.clearTimeout(landingTimer.current); window.clearTimeout(guardTimer.current);
    };
  }, [finish]);

  const total = dice ? dice[0] + dice[1] : null;
  const landed = roundId != null && settledRound === roundId;
  return <div className={cn("lucky7-studio-table", className)} data-testid="dice-table"
    data-scene-version="naina-roll-out-29">
    <DealerFilmStage film={lucky7Dealer} reducedMotion={reduced} roll={dealerRoll} onRelease={release} onLand={land} onFrame={frame} />
    <div className="lucky7-table-title" aria-label="Lucky 7">LUCKY 7</div>
    <div className="lucky7-dice" data-testid="lucky7-dice" data-motion={dice ? motion : "waiting"}
      data-round-id={roundId} data-duration-ms={motion === "roll" ? fromHand ? DICE_FLIGHT_MS : DICE_FALLBACK_MS : 0}
      data-from-hand={fromHand} data-dice-renderer="svg">
      <TableDice ref={tableDice} dice={dice} restDice={presentedDice} roundId={roundId} restRoundId={settledRound}
        motion={motion} fromHand={fromHand} onProgress={progress} />
    </div>
    <span className="sr-only" role="status" data-testid="text-dice-readout">
      {landed ? `Dice ${dice![0]} and ${dice![1]}, total ${total}` : "Waiting for the roll"}
    </span>
    {total !== null && landed && <div className="lucky7-dice-total" data-testid="badge-dice-total" data-total={total}>
      <span>Total</span><strong>{total}</strong><span>{dice![0]} + {dice![1]}</span>
    </div>}
  </div>;
}

export default memo(DiceTable);
