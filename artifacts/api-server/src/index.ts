import { startGameEngines } from "./lib/gameEngines";
import { demoUpgrade } from "./demo/bridge";
import app from "./app";
import { logger } from "./lib/logger";
import {
  bootstrapSuperAdmin,
  ensureGameConfigDefaults,
  logDatabaseTarget,
  seedRoles,
} from "./lib/bootstrap";
import { startReconciliationScheduler } from "./services/reconciliation-scheduler";
import { startCommissionScheduler } from "./services/commission-scheduler";
import { startDemoCleanupScheduler } from "./services/demo-cleanup-scheduler";
import { startRainScheduler } from "./services/rain-scheduler";
import { startWebhookDispatcher } from "./services/webhookDispatcher";
import { attachRealtime } from "./realtime/gateway";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

logDatabaseTarget();

seedRoles()
  .then(() => bootstrapSuperAdmin())
  .then(() => ensureGameConfigDefaults())
  .then(() => {
    startGameEngines();
    startReconciliationScheduler();
    startCommissionScheduler();
    startDemoCleanupScheduler();
    startRainScheduler();
    startWebhookDispatcher();
    // Shared server-scheduled rounds for the five table games (recovers or
    // voids+refunds any rounds interrupted by the previous shutdown first).
  })
  .catch((err) => {
    logger.error({ err }, "startup seeding failed");
  });

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening on 0.0.0.0");
});
attachRealtime(server, demoUpgrade);
server.on("error", (err: Error) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
