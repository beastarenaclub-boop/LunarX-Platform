import { createRainEvent } from "./freeBets";
import { logger } from "../lib/logger";

/**
 * Automatic "rain" giveaways in chat. Every RAIN_INTERVAL_MIN minutes
 * (default 10, env-overridable) a rain event is created and broadcast on
 * the "rain:lunar" topic; the first RAIN_MAX_CLAIMS players to claim each
 * receive one free bet of RAIN_AMOUNT_PAISE. Set RAIN_ENABLED=false to
 * turn scheduled rain off entirely (admins can still trigger manual rain
 * via POST /admin/rain).
 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

const RAIN_ENABLED = (process.env.RAIN_ENABLED ?? "true") !== "false";
const RAIN_INTERVAL_MIN = intEnv("RAIN_INTERVAL_MIN", 10, 1, 24 * 60);
const RAIN_AMOUNT_PAISE = intEnv("RAIN_AMOUNT_PAISE", 5000, 100, 10_000_000);
const RAIN_MAX_CLAIMS = intEnv("RAIN_MAX_CLAIMS", 5, 1, 500);
const RAIN_TTL_SECONDS = intEnv("RAIN_TTL_SECONDS", 120, 15, 3600);

let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    await createRainEvent({
      gameCode: "lunar",
      amountPaise: BigInt(RAIN_AMOUNT_PAISE),
      betsPerClaim: 1,
      maxClaims: RAIN_MAX_CLAIMS,
      message: "It's raining free bets! Tap to claim 🌧️",
      createdBy: null,
      ttlMs: RAIN_TTL_SECONDS * 1000,
    });
  } catch (err) {
    logger.error({ err }, "scheduled rain event failed");
  }
}

export function startRainScheduler() {
  if (!RAIN_ENABLED) {
    logger.info("Rain scheduler disabled (RAIN_ENABLED=false)");
    return;
  }
  if (timer) return;
  timer = setInterval(tick, RAIN_INTERVAL_MIN * 60_000);
  timer.unref();
  logger.info(
    {
      intervalMin: RAIN_INTERVAL_MIN,
      amountPaise: RAIN_AMOUNT_PAISE,
      maxClaims: RAIN_MAX_CLAIMS,
    },
    "Rain scheduler started",
  );
}
