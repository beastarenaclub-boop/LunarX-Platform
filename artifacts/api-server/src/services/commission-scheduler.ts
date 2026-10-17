import { computeCommissions } from "./commission";
import { logger } from "../lib/logger";

function parseHourUTC(raw: string | undefined): number {
  const parsed = parseInt(raw ?? "0", 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 23) return 0;
  return parsed;
}

const COMMISSION_HOUR_UTC = parseHourUTC(process.env.COMMISSION_HOUR_UTC);

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(COMMISSION_HOUR_UTC, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function tick() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0]!;

  try {
    logger.info({ date: dateStr }, "Daily commission computation starting");
    const created = await computeCommissions(dateStr);
    logger.info(
      { date: dateStr, created },
      "Daily commission computation completed",
    );
  } catch (err) {
    logger.error({ err }, "Daily commission computation failed");
  }

  scheduleNext();
}

function scheduleNext() {
  const delay = msUntilNextRun();
  logger.info(
    {
      nextRunIn: `${Math.round(delay / 60_000)}min`,
      hourUTC: COMMISSION_HOUR_UTC,
    },
    "Commission computation scheduled",
  );
  schedulerTimer = setTimeout(tick, delay);
  schedulerTimer.unref();
}

export function startCommissionScheduler() {
  if (schedulerTimer) return;
  scheduleNext();
}

export function stopCommissionScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
