import { startCrashSettlement } from "../services/crashRounds";
import { startBlackjackTimeoutSweeper } from "../services/blackjack";
import { startChickenTimeoutSweeper } from "../services/chickenRoad";
import { startTableRoundEngines } from "../services/tableRounds";
import { startDragonTigerEngine } from "../services/dragonTiger";
import { startOneDayDragonTigerEngine } from "../services/dragonTigerOneDay";
import { startRummyEngine } from "../services/rummy";
import { startPokerEngine } from "../services/poker";
import { startWingoEngine } from "../services/wingo";
import { startLotteryEngine } from "../services/lottery";
import { startPrizeLottoEngine } from "../services/prizeLotto";
import { startForexEngine } from "../services/forex";
import { startVirtualSportsEngine } from "../services/virtualSports";
import { startHorseGameEngine } from "../services/horseGame";
import { startBikeLiveGameEngine } from "../services/bikeLiveGame";
import { startHorseLiveGameEngine } from "../services/horseLiveGame";

export function startGameEngines() {
  startLudoEngine();
  startCrashSettlement();
  startBlackjackTimeoutSweeper();
  startChickenTimeoutSweeper();
  startTableRoundEngines();
  startDragonTigerEngine();
  startOneDayDragonTigerEngine();
  startRummyEngine();
  startPokerEngine();
  startWingoEngine();
  startLotteryEngine();
  startPrizeLottoEngine();
  startForexEngine();
  startVirtualSportsEngine();
  startHorseGameEngine();
  startBikeLiveGameEngine();
  startHorseLiveGameEngine();
}
import { startLudoEngine } from "../services/ludo";
