import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { monitorsTable, spreadsheetConfigTable } from "@workspace/db/schema";
import { researchEbayItem } from "../lib/ebay";
import { fetchInventoryCheckerProducts, type InventoryCheckerProduct } from "../lib/inventoryChecker";
import { linkMonitorsToSpreadsheetRows, updateTrackedTargetCells } from "../lib/sheets";

const router = Router();

async function getInventoryConfig(req: import("express").Request): Promise<{
  base: string;
  apiKey?: string | null;
  ebayAppId?: string | null;
} | null> {
  try {
    const [cfg] = await db.select().from(spreadsheetConfigTable).limit(1);
    const base =
      cfg?.inventoryCheckerBaseUrl?.trim() ||
      process.env.EBAY_INVENTORY_SYNC_BASE_URL?.trim() ||
      "";
    if (!base) return null;
    return {
      base,
      apiKey: cfg?.inventoryCheckerApiKey,
      ebayAppId: cfg?.ebayAppId,
    };
  } catch {
    return null;
  }
}

/** 在庫管理の商品一覧 + 既に監視ありか */
router.get("/products", async (req, res) => {
  const cfg = await getInventoryConfig(req);
  if (!cfg) {
    res.status(400).json({
      error: "inventory_not_configured",
      message: "設定で在庫管理のベース URL を保存するか、環境変数 EBAY_INVENTORY_SYNC_BASE_URL を設定してください。",
    });
    return;
  }
  try {
    const data = await fetchInventoryCheckerProducts({
      baseUrl: cfg.base,
      apiKey: cfg.apiKey,
    });
    const monitors = await db.select().from(monitorsTable);
    const byInv = new Map<number, number>();
    for (const m of monitors) {
      if (m.inventoryProductId != null) byInv.set(m.inventoryProductId, m.id);
    }
    const products = data.products.map((p: InventoryCheckerProduct) => ({
      id: p.id,
      mercari_url: p.mercari_url,
      ebay_url: p.ebay_url,
      purchase_price: p.purchase_price,
      ebay_price_usd: p.ebay_price_usd,
      status: p.status,
      alert_status: p.alert_status,
      last_check: p.last_check,
      monitorId: byInv.get(p.id) ?? null,
    }));
    res.json({ count: products.length, products });
  } catch (err: any) {
    req.log.error({ err }, "listInventoryProducts failed");
    res.status(500).json({ error: "inventory_fetch_failed", message: err.message });
  }
});

/** 出品URLから同一商品リサーチ（在庫の1行を指定） */
router.post("/research", async (req, res) => {
  const rawId = req.body?.inventoryProductId;
  const id = typeof rawId === "number" ? rawId : parseInt(String(rawId), 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "inventory_product_id_required" });
    return;
  }
  const cfg = await getInventoryConfig(req);
  if (!cfg) {
    res.status(400).json({
      error: "inventory_not_configured",
      message: "在庫管理 URL が未設定です。",
    });
    return;
  }
  try {
    const data = await fetchInventoryCheckerProducts({
      baseUrl: cfg.base,
      apiKey: cfg.apiKey,
    });
    const product = data.products.find((p) => p.id === id);
    if (!product) {
      res.status(404).json({ error: "product_not_found" });
      return;
    }
    const url = product.ebay_url?.trim();
    if (!url) {
      res.status(400).json({ error: "no_ebay_url", message: "この商品には eBay URL がありません。" });
      return;
    }
    let appId: string | undefined;
    let devId: string | undefined;
    let certId: string | undefined;
    let userToken: string | undefined;
    try {
      const [c] = await db.select().from(spreadsheetConfigTable).limit(1);
      appId = c?.ebayAppId ?? undefined;
      devId = c?.ebayDevId ?? undefined;
      certId = c?.ebayCertId ?? undefined;
      userToken = c?.ebayUserToken ?? undefined;
    } catch {
      appId = undefined;
    }
    const result = await researchEbayItem(url, {
      appId: appId ?? process.env.EBAY_APP_ID,
      devId,
      certId,
      userToken,
    });
    res.json({
      inventoryProduct: {
        id: product.id,
        mercari_url: product.mercari_url,
        ebay_url: product.ebay_url,
        ebay_price_usd: product.ebay_price_usd,
        status: product.status,
      },
      ...result,
      searchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    req.log.error({ err }, "inventoryResearch failed");
    res.status(500).json({ error: "research_failed", message: err.message });
  }
});

/**
 * 在庫行から監視作成。
 * seedEbayUrl: 候補から選んだ監視起点URL（省略時は在庫の ebay_url）
 */
router.post("/monitors", async (req, res) => {
  const {
    inventoryProductId,
    seedEbayUrl,
    myCondition,
    myPrice,
    trackedTargetCondition,
    trackedTargetPrice,
    syncToSpreadsheetNow,
    label,
    spreadsheetRow,
    checkIntervalMinutes,
  } = req.body ?? {};
  const pid =
    typeof inventoryProductId === "number"
      ? inventoryProductId
      : parseInt(String(inventoryProductId), 10);
  if (!Number.isFinite(pid) || pid < 1) {
    res.status(400).json({ error: "inventory_product_id_required" });
    return;
  }
  if (!myCondition || typeof myCondition !== "string") {
    res.status(400).json({ error: "my_condition_required" });
    return;
  }

  const cfg = await getInventoryConfig(req);
  if (!cfg) {
    res.status(400).json({ error: "inventory_not_configured" });
    return;
  }

  try {
    const data = await fetchInventoryCheckerProducts({
      baseUrl: cfg.base,
      apiKey: cfg.apiKey,
    });
    const product = data.products.find((p) => p.id === pid);
    if (!product) {
      res.status(404).json({ error: "product_not_found" });
      return;
    }
    const fallbackUrl = product.ebay_url?.trim();
    const url = typeof seedEbayUrl === "string" && seedEbayUrl.trim() ? seedEbayUrl.trim() : fallbackUrl;
    if (!url) {
      res.status(400).json({ error: "no_ebay_url", message: "監視起点となる eBay URL がありません。" });
      return;
    }

    const priceNum =
      myPrice !== undefined && myPrice !== null && myPrice !== ""
        ? Number(myPrice)
        : Number(product.ebay_price_usd);
    if (!Number.isFinite(priceNum)) {
      res.status(400).json({ error: "invalid_my_price" });
      return;
    }

    const existing = await db.select().from(monitorsTable).where(eq(monitorsTable.inventoryProductId, pid));
    const effectiveTrackedCondition =
      typeof trackedTargetCondition === "string" && trackedTargetCondition.trim()
        ? trackedTargetCondition.trim()
        : myCondition;
    const parsedTrackedPrice =
      trackedTargetPrice !== undefined && trackedTargetPrice !== null && trackedTargetPrice !== ""
        ? Number(trackedTargetPrice)
        : undefined;
    const effectiveTrackedPrice = Number.isFinite(parsedTrackedPrice as number)
      ? (parsedTrackedPrice as number)
      : priceNum;
    if (existing.length > 0) {
      const [m] = existing;
      const [updated] = await db
        .update(monitorsTable)
        .set({
          ebayUrl: url,
          myPrice: String(priceNum),
          myCondition,
          label: label ?? product.mercari_url ?? m.label,
          spreadsheetRow: spreadsheetRow ?? m.spreadsheetRow,
          checkIntervalMinutes: checkIntervalMinutes ?? m.checkIntervalMinutes ?? 1440,
          isActive: product.status === "active",
        })
        .where(eq(monitorsTable.id, m.id))
        .returning();
      let spreadsheetSynced = false;
      if (syncToSpreadsheetNow !== false) {
        await linkMonitorsToSpreadsheetRows();
        const [fresh] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, updated.id)).limit(1);
        if (fresh?.spreadsheetRow) {
          await updateTrackedTargetCells({
            row: fresh.spreadsheetRow,
            trackedTargetUrl: url,
            trackedTargetCondition: effectiveTrackedCondition,
            trackedTargetPrice: effectiveTrackedPrice,
          });
          spreadsheetSynced = true;
        }
      }
      return res.status(200).json({
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
        hasAlert: false,
        updated: true,
        spreadsheetSynced,
      });
    }

    const [monitor] = await db
      .insert(monitorsTable)
      .values({
        ebayUrl: url,
        myPrice: String(priceNum),
        myCondition,
        label: label || product.mercari_url || url,
        spreadsheetRow: spreadsheetRow ?? null,
        inventoryProductId: pid,
        checkIntervalMinutes: checkIntervalMinutes || 1440,
        isActive: product.status === "active",
      })
      .returning();

    let spreadsheetSynced = false;
    if (syncToSpreadsheetNow !== false) {
      await linkMonitorsToSpreadsheetRows();
      const [fresh] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, monitor.id)).limit(1);
      if (fresh?.spreadsheetRow) {
        await updateTrackedTargetCells({
          row: fresh.spreadsheetRow,
          trackedTargetUrl: url,
          trackedTargetCondition: effectiveTrackedCondition,
          trackedTargetPrice: effectiveTrackedPrice,
        });
        spreadsheetSynced = true;
      }
    }

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
      updated: false,
      spreadsheetSynced,
    });
  } catch (err) {
    req.log.error({ err }, "inventoryCreateMonitor failed");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
