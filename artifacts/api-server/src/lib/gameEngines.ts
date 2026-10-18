import { startCrashSettlement } from "../services/crashRounds";
import { startBlackjackTimeoutSweeper } from "../services/blackjack";
import { startChickenTimeoutSweeper } from "../services/chickenRoad";
import { startTableRoundEngines } from "../services/tableRounds";
import { startDragonTigerEngine } from "../services/dragonTiger";
import { startOneDayDragonTigerEngine } from "../services/dragonTigerOneDay";
import { startRummyEngine } from "../services/rummy";
import { startWingoEngine } from "../services/wingo";
import { startLotteryEngine } from "../services/lottery";
import { startPrizeLottoEngine } from "../services/prizeLotto";
import { startForexEngine } from "../services/forex";
import { startVirtualSportsEngine } from "../services/virtualSports";
import { startHorseGameEngine } from "../services/horseGame";
import { startBikeLiveGameEngine } from "../services/bikeLiveGame";
import { startHorseLiveGameEngine } from "../services/horseLiveGame";

export function startGameEngines() {
  startCrashSettlement();
  startBlackjackTimeoutSweeper();
  startChickenTimeoutSweeper();
  startTableRoundEngines();
  startDragonTigerEngine();
  startOneDayDragonTigerEngine();
  startRummyEngine();
  startWingoEngine();
  startLotteryEngine();
  startPrizeLottoEngine();
  startForexEngine();
  startVirtualSportsEngine();
  startHorseGameEngine();
  startBikeLiveGameEngine();
  startHorseLiveGameEngine();
}
