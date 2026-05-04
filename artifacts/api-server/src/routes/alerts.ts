import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable, monitorsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/alerts", async (req, res) => {
  try {
    const alerts = await db
      .select({
        alert: alertsTable,
        monitor: monitorsTable,
      })
      .from(alertsTable)
      .innerJoin(monitorsTable, eq(alertsTable.monitorId, monitorsTable.id))
      .orderBy(desc(alertsTable.createdAt));

    res.json(alerts.map(({ alert, monitor }) => ({
      id: alert.id,
      monitorId: alert.monitorId,
      monitorLabel: monitor.label || monitor.ebayUrl,
      competitorPrice: parseFloat(alert.competitorPrice),
      competitorCondition: alert.competitorCondition,
      myPrice: parseFloat(alert.myPrice),
      priceDiff: parseFloat(alert.priceDiff),
      isResolved: alert.isResolved,
      spreadsheetSynced: alert.spreadsheetSynced,
      createdAt: alert.createdAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "listAlerts failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/alerts/:id/resolve", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  try {
    const [updated] = await db
      .update(alertsTable)
      .set({ isResolved: true, resolvedAt: new Date() })
      .where(eq(alertsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const monitors = await db
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.id, updated.monitorId));
    const monitor = monitors[0];

    res.json({
      id: updated.id,
      monitorId: updated.monitorId,
      monitorLabel: monitor?.label || monitor?.ebayUrl || "",
      competitorPrice: parseFloat(updated.competitorPrice),
      competitorCondition: updated.competitorCondition,
      myPrice: parseFloat(updated.myPrice),
      priceDiff: parseFloat(updated.priceDiff),
      isResolved: updated.isResolved,
      spreadsheetSynced: updated.spreadsheetSynced,
      createdAt: updated.createdAt.toISOString(),
      resolvedAt: updated.resolvedAt?.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "resolveAlert failed");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
