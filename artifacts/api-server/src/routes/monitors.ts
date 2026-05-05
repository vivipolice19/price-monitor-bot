import { Router } from "express";
import { db } from "@workspace/db";
import { monitorsTable, priceHistoryTable, alertsTable, spreadsheetConfigTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { researchEbayItem } from "../lib/ebay";
import { syncAlertsToSpreadsheet, updateMonitorRowStatus } from "../lib/sheets";
import { reviseEbayListingPrice } from "../lib/repricing";
import { getValidEbayUserAccessTokenFromDb } from "../lib/ebayOAuth";

const router = Router();

router.get("/monitors", async (req, res) => {
  try {
    const monitors = await db.select().from(monitorsTable).orderBy(desc(monitorsTable.createdAt));

    const result = await Promise.all(monitors.map(async (m) => {
      const activeAlerts = await db.select().from(alertsTable)
        .where(eq(alertsTable.monitorId, m.id))
        .limit(1);
      const hasAlert = activeAlerts.some(a => !a.isResolved);

      return {
        id: m.id,
        ebayUrl: m.ebayUrl,
        myPrice: parseFloat(m.myPrice),
        myCondition: m.myCondition,
        label: m.label,
        spreadsheetRow: m.spreadsheetRow,
        inventoryProductId: m.inventoryProductId ?? undefined,
        checkIntervalMinutes: m.checkIntervalMinutes,
        isActive: m.isActive,
        currentLowestPrice: m.currentLowestPrice ? parseFloat(m.currentLowestPrice) : undefined,
        currentLowestCondition: m.currentLowestCondition,
        lastCheckedAt: m.lastCheckedAt?.toISOString(),
        createdAt: m.createdAt.toISOString(),
        hasAlert,
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "listMonitors failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/monitors", async (req, res) => {
  const { ebayUrl, myPrice, myCondition, label, spreadsheetRow, checkIntervalMinutes } = req.body;

  if (!ebayUrl || myPrice === undefined || !myCondition) {
    res.status(400).json({ error: "ebayUrl, myPrice, myCondition are required" });
    return;
  }

  try {
    const [monitor] = await db.insert(monitorsTable).values({
      ebayUrl,
      myPrice: String(myPrice),
      myCondition,
      label: label || null,
      spreadsheetRow: spreadsheetRow || null,
      checkIntervalMinutes: checkIntervalMinutes || 360,
      isActive: true,
    }).returning();

    res.status(201).json({
      id: monitor.id,
      ebayUrl: monitor.ebayUrl,
      myPrice: parseFloat(monitor.myPrice),
      myCondition: monitor.myCondition,
      label: monitor.label,
      spreadsheetRow: monitor.spreadsheetRow,
      inventoryProductId: monitor.inventoryProductId ?? undefined,
      checkIntervalMinutes: monitor.checkIntervalMinutes,
      isActive: monitor.isActive,
      currentLowestPrice: undefined,
      currentLowestCondition: undefined,
      lastCheckedAt: undefined,
      createdAt: monitor.createdAt.toISOString(),
      hasAlert: false,
    });
  } catch (err) {
    req.log.error({ err }, "createMonitor failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/monitors/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  try {
    const [monitor] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, id));
    if (!monitor) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const history = await db.select().from(priceHistoryTable)
      .where(eq(priceHistoryTable.monitorId, id))
      .orderBy(desc(priceHistoryTable.checkedAt))
      .limit(50);

    const activeAlerts = await db.select().from(alertsTable)
      .where(eq(alertsTable.monitorId, id))
      .orderBy(desc(alertsTable.createdAt));

    const hasAlert = activeAlerts.some(a => !a.isResolved);

    res.json({
      id: monitor.id,
      ebayUrl: monitor.ebayUrl,
      myPrice: parseFloat(monitor.myPrice),
      myCondition: monitor.myCondition,
      label: monitor.label,
      spreadsheetRow: monitor.spreadsheetRow,
      inventoryProductId: monitor.inventoryProductId ?? undefined,
      checkIntervalMinutes: monitor.checkIntervalMinutes,
      isActive: monitor.isActive,
      currentLowestPrice: monitor.currentLowestPrice ? parseFloat(monitor.currentLowestPrice) : undefined,
      currentLowestCondition: monitor.currentLowestCondition,
      lastCheckedAt: monitor.lastCheckedAt?.toISOString(),
      createdAt: monitor.createdAt.toISOString(),
      hasAlert,
      recentHistory: history.map(h => ({
        id: h.id,
        monitorId: h.monitorId,
        lowestPrice: parseFloat(h.lowestPrice),
        lowestCondition: h.lowestCondition,
        checkedAt: h.checkedAt.toISOString(),
      })),
      activeAlerts: activeAlerts.map(a => ({
        id: a.id,
        monitorId: a.monitorId,
        competitorPrice: parseFloat(a.competitorPrice),
        competitorCondition: a.competitorCondition,
        myPrice: parseFloat(a.myPrice),
        priceDiff: parseFloat(a.priceDiff),
        isResolved: a.isResolved,
        spreadsheetSynced: a.spreadsheetSynced,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "getMonitor failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.delete("/monitors/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  try {
    await db.delete(monitorsTable).where(eq(monitorsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteMonitor failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.patch("/monitors/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const { myPrice, myCondition, label, spreadsheetRow, inventoryProductId, checkIntervalMinutes, isActive } = req.body;

  try {
    const updateData: Record<string, any> = {};
    if (myPrice !== undefined) updateData.myPrice = String(myPrice);
    if (myCondition !== undefined) updateData.myCondition = myCondition;
    if (label !== undefined) updateData.label = label;
    if (spreadsheetRow !== undefined) updateData.spreadsheetRow = spreadsheetRow;
    if (Object.prototype.hasOwnProperty.call(req.body, "inventoryProductId")) {
      updateData.inventoryProductId = inventoryProductId ?? null;
    }
    if (checkIntervalMinutes !== undefined) updateData.checkIntervalMinutes = checkIntervalMinutes;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db.update(monitorsTable)
      .set(updateData)
      .where(eq(monitorsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const activeAlerts = await db.select().from(alertsTable)
      .where(eq(alertsTable.monitorId, id))
      .limit(1);
    const hasAlert = activeAlerts.some(a => !a.isResolved);

    res.json({
      id: updated.id,
      ebayUrl: updated.ebayUrl,
      myPrice: parseFloat(updated.myPrice),
      myCondition: updated.myCondition,
      label: updated.label,
      spreadsheetRow: updated.spreadsheetRow,
      inventoryProductId: updated.inventoryProductId ?? undefined,
      checkIntervalMinutes: updated.checkIntervalMinutes,
      isActive: updated.isActive,
      currentLowestPrice: updated.currentLowestPrice ? parseFloat(updated.currentLowestPrice) : undefined,
      currentLowestCondition: updated.currentLowestCondition,
      lastCheckedAt: updated.lastCheckedAt?.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      hasAlert,
    });
  } catch (err) {
    req.log.error({ err }, "updateMonitor failed");
    res.status(500).json({ error: "internal_error" });
  }
});

async function performPriceCheck(monitorId: number): Promise<{
  lowestPrice: number;
  lowestCondition: string;
  myPrice: number;
  alertTriggered: boolean;
  repricedTo?: number;
  evidenceUrls: string[];
  message: string;
}> {
  const [monitor] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, monitorId));
  if (!monitor) throw new Error("Monitor not found");

  const myPrice = parseFloat(monitor.myPrice);
  const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
  const { originalItem, lowestByCondition, allItems, evidenceUrls } = await researchEbayItem(monitor.ebayUrl, {
    appId: config?.ebayAppId,
  });

  let lowestPrice = Infinity;
  let lowestCondition = "Unknown";

  const sameConditionItem = lowestByCondition[monitor.myCondition];
  if (sameConditionItem) {
    lowestPrice = sameConditionItem.totalPrice;
    lowestCondition = sameConditionItem.condition;
  } else {
    for (const item of allItems) {
      if (item.totalPrice < lowestPrice) {
        lowestPrice = item.totalPrice;
        lowestCondition = item.condition;
      }
    }
  }

  if (lowestPrice === Infinity) {
    lowestPrice = myPrice;
    lowestCondition = monitor.myCondition;
  }

  await db.update(monitorsTable).set({
    currentLowestPrice: String(lowestPrice),
    currentLowestCondition: lowestCondition,
    lastCheckedAt: new Date(),
  }).where(eq(monitorsTable.id, monitorId));

  await db.insert(priceHistoryTable).values({
    monitorId,
    lowestPrice: String(lowestPrice),
    lowestCondition,
    checkedAt: new Date(),
  });

  let alertTriggered = false;
  let repricedTo: number | undefined;
  let message = `最低価格: $${lowestPrice.toFixed(2)} (${lowestCondition})`;

  if (lowestPrice < myPrice) {
    alertTriggered = true;
    const priceDiff = myPrice - lowestPrice;
    message = `⚠️ アラート: 競合 $${lowestPrice.toFixed(2)} < 自分 $${myPrice.toFixed(2)} (差額: $${priceDiff.toFixed(2)})`;

    await db.insert(alertsTable).values({
      monitorId,
      competitorPrice: String(lowestPrice),
      competitorCondition: lowestCondition,
      myPrice: String(myPrice),
      priceDiff: String(priceDiff),
      isResolved: false,
      spreadsheetSynced: false,
    });

    if (config?.autoRepriceEnabled) {
      const undercutAmount = parseFloat(String(config.undercutAmount ?? "0.01"));
      const minAllowedPrice = config.minAllowedPrice ? parseFloat(String(config.minAllowedPrice)) : undefined;
      let targetPrice = Math.max(0, lowestPrice - undercutAmount);
      if (minAllowedPrice !== undefined && targetPrice < minAllowedPrice) {
        targetPrice = minAllowedPrice;
      }

      if (targetPrice < myPrice) {
        const oauthAccessToken = await getValidEbayUserAccessTokenFromDb();
        const repricing = await reviseEbayListingPrice({
          ebayUrl: monitor.ebayUrl,
          newPrice: targetPrice,
          appId: config.ebayAppId,
          devId: config.ebayDevId,
          certId: config.ebayCertId,
          userToken: config.ebayUserToken,
          oauthAccessToken: oauthAccessToken ?? undefined,
        });
        if (repricing.success) {
          await db.update(monitorsTable)
            .set({ myPrice: String(targetPrice) })
            .where(eq(monitorsTable.id, monitorId));
          repricedTo = targetPrice;
          message = `${message} / 自動改定: $${targetPrice.toFixed(2)}`;
        } else {
          message = `${message} / 自動改定失敗: ${repricing.message}`;
        }
      }
    }

    if (monitor.spreadsheetRow) {
      await updateMonitorRowStatus({
        row: monitor.spreadsheetRow,
        lowestPrice,
        lowestCondition,
        checkedAt: new Date(),
        alertStatus: "要eBay停止",
        repricedValue: repricedTo,
        evidenceUrls,
        trackedTargetUrl: monitor.ebayUrl,
        trackedTargetCondition: originalItem.condition || monitor.myCondition,
        trackedTargetPrice: originalItem.totalPrice,
      });
    }

    try {
      await syncAlertsToSpreadsheet();
    } catch (err) {
      console.error("Auto-sync to spreadsheet failed:", err);
    }
  } else if (monitor.spreadsheetRow) {
    await updateMonitorRowStatus({
      row: monitor.spreadsheetRow,
      lowestPrice,
      lowestCondition,
      checkedAt: new Date(),
      alertStatus: "正常",
      evidenceUrls,
      trackedTargetUrl: monitor.ebayUrl,
      trackedTargetCondition: originalItem.condition || monitor.myCondition,
      trackedTargetPrice: originalItem.totalPrice,
    });
  }

  return { lowestPrice, lowestCondition, myPrice, alertTriggered, repricedTo, evidenceUrls, message };
}

router.post("/monitors/:id/check", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  try {
    const result = await performPriceCheck(id);
    res.json({
      monitorId: id,
      lowestPrice: result.lowestPrice,
      lowestCondition: result.lowestCondition,
      myPrice: result.myPrice,
      alertTriggered: result.alertTriggered,
      repricedTo: result.repricedTo,
      evidenceUrls: result.evidenceUrls,
      message: result.message,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    req.log.error({ err }, "checkMonitorNow failed");
    res.status(500).json({ error: "check_failed", message: err.message });
  }
});

router.get("/monitors/:id/history", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  try {
    const history = await db.select().from(priceHistoryTable)
      .where(eq(priceHistoryTable.monitorId, id))
      .orderBy(desc(priceHistoryTable.checkedAt))
      .limit(100);

    res.json(history.map(h => ({
      id: h.id,
      monitorId: h.monitorId,
      lowestPrice: parseFloat(h.lowestPrice),
      lowestCondition: h.lowestCondition,
      checkedAt: h.checkedAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "getMonitorHistory failed");
    res.status(500).json({ error: "internal_error" });
  }
});

export { performPriceCheck };
export default router;
