import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { runMonitorSyncPipeline } from "./lib/sheets";
import { performPriceCheck } from "./routes/monitors";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  if (process.env.ENABLE_STARTUP_MONITOR_SYNC === "true") {
    runMonitorSyncPipeline().catch((err) => {
      logger.error({ err }, "Initial monitor sync failed");
    });
  } else {
    logger.info("Initial monitor sync skipped (set ENABLE_STARTUP_MONITOR_SYNC=true to enable)");
  }
  startScheduler(performPriceCheck);
});
