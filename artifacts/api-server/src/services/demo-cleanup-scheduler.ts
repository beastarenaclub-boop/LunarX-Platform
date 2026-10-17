import { cleanupIdleDemoAccounts, DEFAULT_DEMO_IDLE_HOURS } from "./demo-cleanup";
import { logger } from "../lib/logger";
import { recordAudit } from "../lib/audit";
import { writeAppLog } from "./appLog";

const RUN_HOUR_UTC = parseInt(process.env.DEMO_CLEANUP_HOUR_UTC ?? "3", 10);
const THRESHOLD_HOURS = parseInt(
  process.env.DEMO_CLEANUP_IDLE_HOURS ?? String(DEFAULT_DEMO_IDLE_HOURS),
  10,
);

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(RUN_HOUR_UTC, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function tick() {
  try {
    logger.info({ thresholdHours: THRESHOLD_HOURS }, "Demo cleanup starting");
    const result = await cleanupIdleDemoAccounts(THRESHOLD_HOURS);
    logger.info({ ...result }, "Demo cleanup finished");
    await recordAudit({
      actorId: null,
      action: "demo_accounts.cleanup",
      targetType: "demo_accounts",
      after: {
        deleted: result.deleted,
        thresholdHours: THRESHOLD_HOURS,
        source: "scheduler",
      },
    });
    await writeAppLog({
      kind: "scheduler",
      message: `Scheduled demo cleanup purged ${result.deleted} account(s) (threshold ${THRESHOLD_HOURS}h)`,
    });
  } catch (err) {
    logger.error({ err }, "Demo cleanup failed");
  }
  scheduleNext();
}

function scheduleNext() {
  const delay = msUntilNextRun();
  logger.info(
    {
      nextRunIn: `${Math.round(delay / 60_000)}min`,
      hourUTC: RUN_HOUR_UTC,
      thresholdHours: THRESHOLD_HOURS,
    },
    "Demo cleanup scheduled",
  );
  schedulerTimer = setTimeout(tick, delay);
  schedulerTimer.unref();
}

export function startDemoCleanupScheduler() {
  if (schedulerTimer) return;
  scheduleNext();
}

export function stopDemoCleanupScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
