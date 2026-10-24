import { GameInformationDrawer } from "@/components/game/GameInformation";
import BaccaratRules from "@/components/baccarat/BaccaratRules";
import { useEffect, useMemo, useState } from "react";
import { Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { customFetch } from "@workspace/api-client-react";
import { GameInformationTarget, restoreGameInformationFocus } from "./GameInformation";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GameRulesCode =
  | "lunar"
  | "aviator"
  | "jetx"
  | "fury"
  | "mines"
  | "plinko"
  | "dice"
  | "roulette"
  | "baccarat"
  | "blackjack"
  | "teen-patti"
  | "andar-bahar"
  | "lucky-7";

export interface GameRules {
  name: string;
  objective: string;
  controls: string;
  phases: string;
  payouts: string;
  limits: string;
  rtp: string;
  fairness: string;
}

const CRASH_RULES: GameRules = {
  name: "Crash",
  objective: "Place a stake before the round starts and cash out while the multiplier is rising. If the round crashes before you cash out, that stake loses.",
  controls: "Select coins in a panel. At the end of the betting countdown, that stake is placed automatically. Cancel your selection before the timer ends. Cash Out during flight. A second panel is an independent stake.",
  phases: "Betting accepts stakes; the round then flies and the multiplier rises; the crash ends cash-out eligibility; settlement credits completed cash-outs.",
  payouts: "A successful cash-out returns stake × the displayed cash-out multiplier. Example: ₹100 at 2.50× returns ₹250 (₹150 profit). A crash before cash-out returns ₹0.",
  limits: "Minimum stake is ₹1. The server-configured maximum stake and any panel limits are enforced when the bet is placed.",
  rtp: "This is an edge-scaled game. The configured house edge is applied by the server (RTP = 100% − house edge); it describes long-run theoretical return, not an individual round or a guaranteed cash-out.",
  fairness: "Use the separate Provably Fair control to inspect the committed server-seed hash, client seed, nonce, and later verification data. A hash is a commitment, not a prediction.",
};

export const GAME_RULES: Record<GameRulesCode, GameRules> = {
  lunar: { ...CRASH_RULES, name: "Lunar Crash" },
  aviator: { ...CRASH_RULES, name: "Aviator" },
  jetx: { ...CRASH_RULES, name: "JetX" },
  fury: { ...CRASH_RULES, name: "Fury Flight" },
  mines: {
    name: "Mines",
    objective: "Reveal safe cells and stop before revealing a mine. The more safe cells you reveal, the higher the available multiplier.",
    controls: "Set the mine count, then select a coin. After the three-second countdown your round starts automatically. Cancel before the countdown ends to stop it. Reveal cells and Cash Out after a safe reveal.",
    phases: "Place a round; reveal safe cells one at a time; cash out or hit a mine; settlement records the result.",
    payouts: "Cash-out returns stake × the current multiplier. Example: ₹100 at 1.80× returns ₹180. Hitting a mine returns ₹0; cashing out never guarantees a profit.",
    limits: "Minimum stake is ₹1. The server-configured maximum stake, grid, and available mine counts are enforced by the game.",
    rtp: "Mines is edge-scaled. The configured house edge determines the theoretical long-run RTP; it does not predict which cells are safe in this round.",
    fairness: "The fairness view shows the server-seed commitment and client seed. After the seed is rotated, use the round verification action to replay the result.",
  },
  plinko: {
    name: "Plinko",
    objective: "Drop a ball through the selected number of rows and risk level. The bucket where it lands determines the multiplier.",
    controls: "Set rows and risk, then select a coin. A single drop starts automatically after three seconds. You can cancel before the timer ends. Repeat mode is optional.",
    phases: "A drop is accepted; the ball animates through the pegs; the bucket multiplier is revealed; settlement credits the payout.",
    payouts: "Payout is stake × the landed bucket multiplier. Example: ₹100 in a 3.00× bucket returns ₹300. A bucket below 1.00× returns less than stake.",
    limits: "Minimum stake is ₹1. The server-configured maximum stake, row options, risk options, and maximum multiplier apply.",
    rtp: "Plinko uses an edge-scaled theoretical RTP based on the selected rows/risk table and configured house edge. RTP is not a promise for any one drop.",
    fairness: "Record the displayed seed hash before dropping. Rotate the seed to reveal the prior server seed, then use the round verification action to reproduce the path and bucket.",
  },
  dice: {
    name: "Dice",
    objective: "Set a target and choose Roll Over or Roll Under. Win when the server roll lands in your selected zone.",
    controls: "Set target and direction, then select a coin. A single roll starts automatically after three seconds. Cancel before the timer ends to stop it. Repeat mode is optional.",
    phases: "Place the roll; a value from the server range is generated; the target comparison decides win/loss; settlement returns the calculated payout.",
    payouts: "A win returns stake × the shown multiplier; a loss returns ₹0. Example: ₹100 at 1.90× returns ₹190. The displayed multiplier already reflects the chance and edge.",
    limits: "Minimum stake is ₹1. Target bounds and the server-configured maximum stake/multiplier are enforced by the server.",
    rtp: "Dice is edge-scaled: theoretical RTP is 100% minus the configured house edge, subject to the server multiplier cap. It does not guarantee a win or return on an individual roll.",
    fairness: "Record the seed hash and client seed, then rotate the seed and use verification on a completed roll to recompute the roll, comparison, and multiplier.",
  },
  roulette: {
    name: "Roulette",
    objective: "Predict the pocket where the single-zero wheel ball will land by placing one or more table bets.",
    controls: "Select a chip and tap the betting board. Your selected chips submit automatically when the countdown ends. Clear or undo before that time. Selections do not carry to another round.",
    phases: "Betting is open; the table closes; the wheel spins and reveals one pocket; all accepted bets settle together.",
    payouts: "Straight-up pays 35:1 profit (₹100 returns ₹3,600 including stake); red/black, odd/even and other outside bets use their board labels. A losing bet returns ₹0.",
    limits: "Minimum chip is ₹1. The server-configured maximum stake, number of bets, and maximum multiplier apply per round.",
    rtp: "This is a fixed single-zero paytable. Its theoretical RTP is determined by the 37 pockets and posted payouts (not an editable RTP target); it is not a guarantee for a spin.",
    fairness: "The separate fairness and verification views expose the commitment, seeds, nonce, pocket, and payout replay for completed rounds.",
  },
  baccarat: {
    name: "Baccarat VIP",
    objective: "Bet on Player, Banker, Tie, a pair, or the winning hand's final score. The hand closest to 9 wins under baccarat dealing rules. Score bets lose on a tie, including 0-0.",
    controls: "Select chips on the available spots. Your slip submits automatically when the countdown ends. Review, clear or undo before that time.",
    phases: "Betting opens; two hands are dealt and a third card may be drawn by baccarat rules; the result is revealed; accepted bets settle.",
    payouts: "Player and Banker pay 1:1 profit, except Banker winning with 6 pays 0.5:1. Tie pays 8:1 and pairs pay 11:1. Winning bets return stake plus profit; losing bets return ₹0.",
    limits: "Minimum chip is ₹1. The server-configured maximum stake and bets per deal apply; the active table configuration is authoritative.",
    rtp: "Baccarat uses its fixed server paytable. Theoretical RTP varies by spot and the configured deck/dealing rules; it is not a guarantee for the next deal.",
    fairness: "Use the separate fairness action and completed-round verification to inspect the committed seeds, deal, winner, and payout replay.",
  },
  blackjack: {
    name: "Blackjack",
    objective: "Make a hand closer to 21 than the dealer without busting. Face cards count 10, aces count 1 or 11.",
    controls: "Select a coin during betting. Your hand is entered automatically when the countdown ends. Cancel the selection before that time. Use Hit, Stand, Double, Split and Insurance when available after the deal.",
    phases: "Betting/deal; insurance may be offered; player actions; dealer completes the hand; each hand and insurance wager settles.",
    payouts: "A natural blackjack pays 3:2 where shown (₹100 returns ₹250); a standard win pays 1:1; a push returns the stake; a loss returns ₹0. Double and split create additional stake.",
    limits: "Minimum stake is ₹1. The server-configured maximum stake and action/table limits apply, including extra stake for Double, Split, or Insurance.",
    rtp: "Blackjack is a fixed rules/paytable game. Theoretical return depends on the published rules and player decisions; it never guarantees a result on one hand.",
    fairness: "The fairness view commits the deck seed. Rotate the seed and use completed-hand verification to replay the deal and settlement.",
  },
  "teen-patti": {
    name: "Teen Patti 20/20",
    objective: "Bet on Player A, Player B, Tie, or Pair+ and compare the two three-card hands using Teen Patti rankings.",
    controls: "Select chips on the available spots. Your slip submits automatically when the countdown ends. Review, clear or undo before that time.",
    phases: "Betting opens; both three-card hands are dealt; hand categories and winner are revealed; each accepted spot settles.",
    payouts: "Player A/B pay 0.95:1, Tie pays 875:1, and Pair+ pays according to the posted category table (up to 35:1). A ₹100 win returns stake plus posted profit; losses return ₹0.",
    limits: "Minimum chip is ₹1. The server-configured maximum stake and bets per deal apply.",
    rtp: "Teen Patti uses a fixed server paytable. Theoretical RTP differs by spot and hand category; it describes many rounds, not an individual deal.",
    fairness: "Use the separate fairness and completed-round verification actions to replay the committed deal and payout.",
  },
  "andar-bahar": {
    name: "Andar Bahar",
    objective: "Predict whether matching cards will appear first on the Andar or Bahar side after the joker card.",
    controls: "Select chips on Andar, Bahar or a card-range side bet. Selected chips submit automatically when the countdown ends. Clear or undo before that time.",
    phases: "The joker is shown; cards are dealt alternately to Andar and Bahar; the side matching the joker wins; accepted bets settle.",
    payouts: "Andar/Bahar use the posted asymmetric fixed payouts (0.9:1 / 1:1); range bets pay their posted 2.5:1 through 120:1 amounts. A ₹100 win returns stake plus the posted profit.",
    limits: "Minimum chip is ₹1. The server-configured maximum stake applies to the slip and each supported bet.",
    rtp: "Andar Bahar uses fixed asymmetric payouts and fixed range paytables, so theoretical RTP varies by spot. RTP is not a prediction of the next deal.",
    fairness: "The separate fairness action and completed-round verification replay the joker, card order, winner, and payout from the committed seeds.",
  },
  "lucky-7": {
    name: "Lucky 7",
    objective: "Bet on the server-defined Lucky 7 outcome categories and compare the two dice total with the posted table.",
    controls: "Select a chip and tap Lucky 7 spots. Selected chips submit together when the countdown ends. Cancel clears your selected chips before submission.",
    phases: "Betting opens; two dice are rolled; the total/category is revealed; accepted bets settle.",
    payouts: "Under 7 (2–6) and Over 7 (8–12) return ₹2 for every ₹1 bet. Exactly 7 returns ₹12 for every ₹1 bet. These total returns include your stake. On 7, both Under and Over lose; all losing bets return ₹0.",
    limits: "Minimum chip is ₹1. The server-configured maximum stake and bets per round apply.",
    rtp: "Two fair dice have 36 equally likely outcomes. At these fixed payouts, theoretical RTP is 83.33% for Under/Over and 200% for Exactly 7. RTP describes many rounds, not one roll.",
    fairness: "Use the separate fairness and completed-round verification actions to replay the dice outcome and payout.",
  },
};

const FALLBACK_RULES: GameRules = {
  name: "Game rules",
  objective: "Place a stake and follow the controls shown on this game surface.",
  controls: "Only bets accepted by the server are eligible for settlement.",
  phases: "Betting, outcome reveal, and settlement are controlled by the server round.",
  payouts: "Wins and losses are calculated by the server paytable; check the result shown after settlement.",
  limits: "The server-enforced minimum, maximum, and enabled options shown in the controls apply.",
  rtp: "Odds and RTP are theoretical long-run measures and do not guarantee any individual result.",
  fairness: "Use the separate fairness or verification action when available. Never treat a seed hash as a prediction.",
};

function legacyGameRules(code: string): GameRules {
  if (code === "teen-patti-live") return {
    ...GAME_RULES["teen-patti"],
    name: "Teen Patti Live",
    payouts: "Winning spots use the return multipliers displayed on this table. Pair+ uses the category multipliers in the paytable above. These returns include the winning stake; losing spots return zero.",
    limits: "The current table's minimum, maximum stake and slip limits apply. Only bets accepted before the betting window closes enter the round.",
  };
  return GAME_RULES[code as GameRulesCode] ?? { ...FALLBACK_RULES, name: `Rules for ${code}` };
}

export function GameRulesButton({ gameCode }: { gameCode: string }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<{
    houseEdge?: number;
    minStakePaise?: string;
    maxStakePaise?: string;
  } | null>(null);
  const rules = useMemo(() => getGameRules(gameCode), [gameCode]);
  const isEdgeScaled = ["lunar", "aviator", "jetx", "fury", "mines", "plinko", "dice"].includes(gameCode);

  useEffect(() => {
    setOpen(false);
    setConfig(null);
    if (!isEdgeScaled && gameCode !== "lucky-7") return;
    let cancelled = false;
    const path = ["lunar", "aviator", "jetx", "fury"].includes(gameCode)
      ? `/api/game/config/${gameCode}/public`
      : gameCode === "lucky-7"
        ? "/api/lucky-7/config"
        : `/api/${gameCode}/config`;
    void customFetch<typeof config>(path, { method: "GET" })
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        // The registry remains useful when a new/disabled game has no public config.
      });
    return () => {
      cancelled = true;
    };
  }, [gameCode, isEdgeScaled]);

  const formatRupees = (paise?: string) =>
    paise ? `₹${(Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : null;
  const liveLimits = config
    ? `The current server configuration allows ${formatRupees(config.minStakePaise) ?? "the configured minimum"} to ${formatRupees(config.maxStakePaise) ?? "the configured maximum"} per stake.`
    : null;
  const liveRtp = isEdgeScaled && typeof config?.houseEdge === "number"
    ? `The server currently configures a ${(config.houseEdge * 100).toFixed(2)}% house edge (theoretical RTP ${(100 - config.houseEdge * 100).toFixed(2)}%). This is a long-run measure, not a promise for this round.`
    : null;
  const displayRules = {
    ...rules,
    limits: liveLimits ? `${liveLimits} ${rules.limits}` : rules.limits,
    rtp: liveRtp ?? rules.rtp,
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-white/70 hover:text-white h-10 w-10 rounded-full"
        aria-label={`Game information for ${rules.name}`}
        title={`Game information for ${rules.name}`}
        onClick={() => setOpen(true)}
        data-testid="btn-game-rules"
      >
        <Info className="w-5 h-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <GameInformationDrawer onCloseAutoFocus={restoreGameInformationFocus} className="max-w-2xl max-h-[min(85dvh,720px)] overflow-y-auto bg-[#130b24] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black uppercase tracking-wider">
              <Info className="w-4 h-4 text-emerald-300" />
              {rules.name} information
            </DialogTitle>
            <DialogDescription className="text-white/55">
              Read the rules before playing. Results are random server outcomes; RTP describes long-run theory, not a promise for a round.
            </DialogDescription>
          </DialogHeader>
          <GameInformationTarget />
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            {([
              ["Objective", displayRules.objective],
              ["Controls and bets", displayRules.controls],
              ["Round phases", displayRules.phases],
              ["Wins, losses and payouts", displayRules.payouts],
              ["Limits", displayRules.limits],
              ["RTP / house edge", displayRules.rtp],
              ["Fairness", displayRules.fairness],
            ] as const).map(([title, text]) => (
              <section key={title} className="rounded-lg border border-white/10 bg-black/10 p-3 sm:col-span-1">
                <h3 className="font-bold text-white/90">{title}</h3>
                <p className="mt-1 leading-relaxed text-white/65">{text}</p>
              </section>
            ))}
          </div>
          {gameCode === "baccarat" && <BaccaratRules />}
          <p className="flex items-start gap-2 text-xs text-white/45">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/70" />
            The separate provably-fair control remains available for seed commitments and verification; this panel does not alter game math.
          </p>
        </GameInformationDrawer>
      </Dialog>
    </>
  );
}

export function getGameRules(code: string): GameRules {
  const rules = legacyGameRules(code);
  const payouts: Record<string, string> = {
    "lucky-7": "Under/Over return 2.04×; Exactly 7 returns 5.10×, including stake. A 7 loses Under and Over.",
    roulette: "Total return includes your stake: straight 36× (₹1 returns ₹36), split 18×, street 12×, corner 9×, six-number line 6×, dozen/column 3×, red/black and other outside bets 2×. Zero loses the outside bets. Accepted older rounds retain their original paytable.",
    baccarat: "Profit odds: Player 1:1; Banker 1:1, except a Banker win with 6 pays 0.5:1; Tie 8:1; Player Pair and Banker Pair 11:1. Winning-score bets: 1–4 pays 7.5:1, 5–6 pays 4:1, 7 pays 4.5:1, 8 pays 3:1 and 9 pays 2.5:1. Winning bets also return the stake. On a tie, Player/Banker main bets push and all score bets lose; pairs still settle independently. The Banker 6 exception applies only to the Banker main bet. Previously accepted rounds retain their posted rates.",
    "teen-patti": "Player A/B and Pair+ use the posted total-return rates. Exact ties push main bets. Rates target 85% RTP, rounded down.",
    "teen-patti-live": "Player A/B and Pair+ use the posted total-return rates. Exact ties push main bets. Rates target 85% RTP, rounded down.",
    "andar-bahar": "Starting/other side and card ranges use the posted total-return rates. All prices include the original stake and round down to paise.",
    blackjack: "New hands return 85% of the standard total payout: a win 1.70×; natural blackjack 2.125×; draw 0.85×; winning insurance 2.55×. Losses return zero. Aborted hands are refunded in full.",
    rummy: "The winner receives the four-player pot after a disclosed 15% table commission. A void game refunds the entry. Skill and opponents affect your return.",
    "vegetable-bowl": "Normal/Hard return 1.87× and Risk returns 18.96× including stake. Junk loses every spot.",
    "forex-trading": "New rounds have independent 50/50 UP/DOWN results. Correct predictions return 1.70× including stake; incorrect predictions return zero. Market quotes and bet totals do not decide results.",
  };
  return { ...rules, ...(payouts[code] ? { payouts: payouts[code] } : {}),
    ...(code === "roulette" ? { limits: "₹10 minimum on every selection. Single numbers (including zero): ₹20,000 maximum; multi-number and outside selections: ₹1,00,000 maximum. Limits combine all bets on the same selection per player per round. The overall table slip limit also applies. Auto bet sends only your selected chips for the current round; a new round requires a new selection." } : {}),
    rtp: code === "roulette" ? "37 equally likely pockets and a 36-base paytable give 97.2973% theoretical RTP and a 2.7027% house edge. Results are independent of stakes. Neither a round nor a session guarantees company profit."
      : code === "baccarat" ? "Fixed odds with half profit on Banker wins totaling 6. Theoretical RTP varies by bet and the eight-deck drawing rules; these prices are not adjusted to an 85% target. Previously accepted rounds keep their original paytable."
      : code === "blackjack" ? "Returns are 85% of the standard paytable; actual RTP depends on player strategy and the card rules, so it is not an exact 85% guarantee."
      : code === "rummy" ? "15% table commission. Individual RTP is skill-dependent and is not fixed at 85%."
      : "85% theoretical RTP target over many plays (15% expected house margin), subject to posted price rounding and multiplier caps. Individual rounds and sessions can lose money for either side. Previously accepted bets retain their original terms." };
}
