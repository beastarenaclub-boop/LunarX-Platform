import { runReconciliation } from "./reconciliation";
import { logger } from "../lib/logger";

const RECON_HOUR_UTC = parseInt(process.env.RECON_HOUR_UTC ?? "2", 10);

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(RECON_HOUR_UTC, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function tick() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  try {
    logger.info({ date: yesterday.toISOString().split("T")[0] }, "Daily reconciliation starting");
    const result = await runReconciliation(yesterday);
    logger.info(
      { date: yesterday.toISOString().split("T")[0], ...result },
      "Daily reconciliation completed",
    );
  } catch (err) {
    logger.error({ err }, "Daily reconciliation failed");
  }

  scheduleNext();
}

function scheduleNext() {
  const delay = msUntilNextRun();
  logger.info(
    { nextRunIn: `${Math.round(delay / 60_000)}min`, hourUTC: RECON_HOUR_UTC },
    "Reconciliation scheduled",
  );
  schedulerTimer = setTimeout(tick, delay);
  schedulerTimer.unref();
}

export function startReconciliationScheduler() {
  if (schedulerTimer) return;
  scheduleNext();
}

export function stopReconciliationScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
