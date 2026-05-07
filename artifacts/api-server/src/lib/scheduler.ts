import cron, { type ScheduledTask } from "node-cron";
import { db } from "@workspace/db";
import { monitorsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { runMonitorSyncPipeline } from "./sheets";

let scheduledTask: ScheduledTask | null = null;

export function startScheduler(performPriceCheck: (id: number) => Promise<any>) {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule("0 * * * *", async () => {
    logger.info("Running scheduled price checks");

    try {
      if (process.env.ENABLE_PERIODIC_MONITOR_SYNC === "true") {
        await runMonitorSyncPipeline();
      }
      const monitors = await db.select().from(monitorsTable)
        .where(eq(monitorsTable.isActive, true));

      const now = new Date();

      for (const monitor of monitors) {
        try {
          const lastChecked = monitor.lastCheckedAt;
          const intervalMs = (monitor.checkIntervalMinutes ?? 1440) * 60 * 1000;

          if (lastChecked && (now.getTime() - lastChecked.getTime()) < intervalMs) {
            continue;
          }

          logger.info({ monitorId: monitor.id }, "Checking monitor price");
          await performPriceCheck(monitor.id);
        } catch (err) {
          logger.error({ err, monitorId: monitor.id }, "Scheduled price check failed for monitor");
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduled price check run failed");
    }
  });

  logger.info("Price monitor scheduler started (hourly, checks every 24 hours per item by default)");
}
