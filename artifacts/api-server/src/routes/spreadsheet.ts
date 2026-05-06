import { Router } from "express";
import { db } from "@workspace/db";
import { spreadsheetConfigTable } from "@workspace/db/schema";
import {
  testSheetsConnection,
  syncAlertsToSpreadsheet,
  getRowPrice,
  suggestSpreadsheetColumns,
  runMonitorSyncPipeline,
  syncMonitorsFromInventoryChecker,
} from "../lib/sheets";
import { triggerInventoryCheckerSync } from "../lib/inventoryChecker";

const router = Router();

function isMissingSpreadsheetTable(err: unknown): boolean {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: string }).message)
      : String(err);
  return /spreadsheet_config|42P01|does not exist|relation .* does not exist/i.test(raw);
}

router.get("/spreadsheet/config", async (req, res) => {
  try {
    const configs = await db.select().from(spreadsheetConfigTable).limit(1);
    const config = configs[0];

    if (!config) {
      res.json({
        isConfigured: false,
        hasServiceAccount: false,
        hasEbayCredentials: false,
        hasEbayOAuth: false,
        inventoryCheckerBaseUrl: "",
        hasInventoryCheckerApiKey: false,
        inventoryStatusColumnIndex: 5,
        trackedTargetUrlColumnIndex: 14,
        trackedTargetConditionColumnIndex: 15,
        trackedTargetPriceColumnIndex: 16,
        ebayListingConditionColumnIndex: undefined,
        ebayOAuthRedirectUri: "",
      });
      return;
    }

    res.json({
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      alertColumnIndex: config.alertColumnIndex,
      priceColumnIndex: config.priceColumnIndex,
      myPriceColumnIndex: config.myPriceColumnIndex,
      sourceUrlColumnIndex: config.sourceUrlColumnIndex,
      ebayUrlColumnIndex: config.ebayUrlColumnIndex,
      lowestPriceColumnIndex: config.lowestPriceColumnIndex,
      lowestConditionColumnIndex: config.lowestConditionColumnIndex,
      lastCheckColumnIndex: config.lastCheckColumnIndex,
      alertStatusColumnIndex: config.alertStatusColumnIndex,
      repricedValueColumnIndex: config.repricedValueColumnIndex,
      evidenceUrlsColumnIndex: config.evidenceUrlsColumnIndex,
      trackedTargetUrlColumnIndex: config.trackedTargetUrlColumnIndex ?? 14,
      trackedTargetConditionColumnIndex: config.trackedTargetConditionColumnIndex ?? 15,
      trackedTargetPriceColumnIndex: config.trackedTargetPriceColumnIndex ?? 16,
      autoRepriceEnabled: config.autoRepriceEnabled,
      undercutAmount: config.undercutAmount ? parseFloat(String(config.undercutAmount)) : 0.01,
      minAllowedPrice: config.minAllowedPrice ? parseFloat(String(config.minAllowedPrice)) : undefined,
      hasEbayCredentials: !!(
        (config.ebayAppId && config.ebayDevId && config.ebayCertId && config.ebayUserToken) ||
        (config.ebayAppId && config.ebayOAuthClientSecret && config.ebayOAuthRefreshToken)
      ),
      hasEbayOAuth: !!config.ebayOAuthRefreshToken,
      inventoryCheckerBaseUrl: config.inventoryCheckerBaseUrl ?? "",
      hasInventoryCheckerApiKey: !!config.inventoryCheckerApiKey,
      inventoryStatusColumnIndex: config.inventoryStatusColumnIndex ?? 5,
      ebayListingConditionColumnIndex: config.ebayListingConditionColumnIndex ?? undefined,
      ebayOAuthRedirectUri: config.ebayOAuthRedirectUri ?? "",
      isConfigured: config.isConfigured,
      hasServiceAccount: !!config.serviceAccountJson,
    });
  } catch (err) {
    if (isMissingSpreadsheetTable(err)) {
      req.log.warn({ err }, "getSpreadsheetConfig: table missing");
      res.json({
        isConfigured: false,
        hasServiceAccount: false,
        hasEbayCredentials: false,
        hasEbayOAuth: false,
        inventoryCheckerBaseUrl: "",
        hasInventoryCheckerApiKey: false,
        inventoryStatusColumnIndex: 5,
        trackedTargetUrlColumnIndex: 14,
        trackedTargetConditionColumnIndex: 15,
        trackedTargetPriceColumnIndex: 16,
        ebayListingConditionColumnIndex: undefined,
        ebayOAuthRedirectUri: "",
        databaseNeedsMigration: true,
        setupMessageJa:
          "PostgreSQL にまだテーブルがありません。Render の環境変数 DATABASE_URL が付いた状態でサービスを再デプロイすると、ビルド時にテーブルを自動作成します。DATABASE_URL を今付けた直後なら Manual Deploy で再ビルドしてください。自分のPCから行う場合は lib/db で pnpm exec drizzle-kit push と同等の処理です。",
      });
      return;
    }
    req.log.error({ err }, "getSpreadsheetConfig failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/spreadsheet/config", async (req, res) => {
  const {
    spreadsheetId,
    sheetName,
    alertColumnIndex,
    priceColumnIndex,
    myPriceColumnIndex,
    sourceUrlColumnIndex,
    ebayUrlColumnIndex,
    lowestPriceColumnIndex,
    lowestConditionColumnIndex,
    lastCheckColumnIndex,
    alertStatusColumnIndex,
    repricedValueColumnIndex,
    evidenceUrlsColumnIndex,
    trackedTargetUrlColumnIndex,
    trackedTargetConditionColumnIndex,
    trackedTargetPriceColumnIndex,
    autoRepriceEnabled,
    undercutAmount,
    minAllowedPrice,
    ebayAppId,
    ebayDevId,
    ebayCertId,
    ebayUserToken,
    inventoryCheckerBaseUrl,
    inventoryCheckerApiKey,
    inventoryStatusColumnIndex,
    ebayListingConditionColumnIndex,
    ebayOAuthRedirectUri,
    ebayOAuthClientSecret,
    serviceAccountJson,
  } = req.body;

  if (!spreadsheetId || !sheetName) {
    res.status(400).json({ error: "spreadsheetId and sheetName are required" });
    return;
  }

  try {
    const configs = await db.select().from(spreadsheetConfigTable).limit(1);
    const existing = configs[0];

    const updateData: Record<string, any> = {
      spreadsheetId,
      sheetName,
      alertColumnIndex: alertColumnIndex ?? 11,
      priceColumnIndex: priceColumnIndex ?? 8,
      myPriceColumnIndex: myPriceColumnIndex ?? 3,
      sourceUrlColumnIndex: sourceUrlColumnIndex ?? 0,
      ebayUrlColumnIndex: ebayUrlColumnIndex ?? 1,
      lowestPriceColumnIndex: lowestPriceColumnIndex ?? 8,
      lowestConditionColumnIndex: lowestConditionColumnIndex ?? 9,
      lastCheckColumnIndex: lastCheckColumnIndex ?? 10,
      alertStatusColumnIndex: alertStatusColumnIndex ?? 11,
      repricedValueColumnIndex: repricedValueColumnIndex ?? 12,
      evidenceUrlsColumnIndex: evidenceUrlsColumnIndex ?? 13,
      trackedTargetUrlColumnIndex: trackedTargetUrlColumnIndex ?? 14,
      trackedTargetConditionColumnIndex: trackedTargetConditionColumnIndex ?? 15,
      trackedTargetPriceColumnIndex: trackedTargetPriceColumnIndex ?? 16,
      autoRepriceEnabled: autoRepriceEnabled ?? false,
      undercutAmount: String(undercutAmount ?? 0.01),
      minAllowedPrice: minAllowedPrice !== undefined ? String(minAllowedPrice) : null,
      isConfigured: true,
    };

    if (serviceAccountJson) {
      updateData.serviceAccountJson = serviceAccountJson;
    }
    if (ebayAppId) updateData.ebayAppId = ebayAppId;
    if (ebayDevId) updateData.ebayDevId = ebayDevId;
    if (ebayCertId) updateData.ebayCertId = ebayCertId;
    if (ebayUserToken) updateData.ebayUserToken = ebayUserToken;
    if (inventoryCheckerBaseUrl !== undefined) {
      updateData.inventoryCheckerBaseUrl = inventoryCheckerBaseUrl || null;
    }
    if (inventoryCheckerApiKey) updateData.inventoryCheckerApiKey = inventoryCheckerApiKey;
    if (inventoryStatusColumnIndex !== undefined) {
      updateData.inventoryStatusColumnIndex = inventoryStatusColumnIndex;
    }
    if (ebayListingConditionColumnIndex !== undefined) {
      updateData.ebayListingConditionColumnIndex =
        ebayListingConditionColumnIndex === null ? null : Number(ebayListingConditionColumnIndex);
    }
    if (ebayOAuthRedirectUri !== undefined) {
      updateData.ebayOAuthRedirectUri = ebayOAuthRedirectUri || null;
    }
    if (ebayOAuthClientSecret) updateData.ebayOAuthClientSecret = ebayOAuthClientSecret;

    let saved;
    if (existing) {
      const [updated] = await db.update(spreadsheetConfigTable)
        .set(updateData)
        .returning();
      saved = updated;
    } else {
      const [created] = await db.insert(spreadsheetConfigTable)
        .values(updateData)
        .returning();
      saved = created;
    }

    res.json({
      spreadsheetId: saved.spreadsheetId,
      sheetName: saved.sheetName,
      alertColumnIndex: saved.alertColumnIndex,
      priceColumnIndex: saved.priceColumnIndex,
      myPriceColumnIndex: saved.myPriceColumnIndex,
      sourceUrlColumnIndex: saved.sourceUrlColumnIndex,
      ebayUrlColumnIndex: saved.ebayUrlColumnIndex,
      lowestPriceColumnIndex: saved.lowestPriceColumnIndex,
      lowestConditionColumnIndex: saved.lowestConditionColumnIndex,
      lastCheckColumnIndex: saved.lastCheckColumnIndex,
      alertStatusColumnIndex: saved.alertStatusColumnIndex,
      repricedValueColumnIndex: saved.repricedValueColumnIndex,
      evidenceUrlsColumnIndex: saved.evidenceUrlsColumnIndex,
      trackedTargetUrlColumnIndex: saved.trackedTargetUrlColumnIndex ?? 14,
      trackedTargetConditionColumnIndex: saved.trackedTargetConditionColumnIndex ?? 15,
      trackedTargetPriceColumnIndex: saved.trackedTargetPriceColumnIndex ?? 16,
      autoRepriceEnabled: saved.autoRepriceEnabled,
      undercutAmount: saved.undercutAmount ? parseFloat(String(saved.undercutAmount)) : 0.01,
      minAllowedPrice: saved.minAllowedPrice ? parseFloat(String(saved.minAllowedPrice)) : undefined,
      hasEbayCredentials: !!(
        (saved.ebayAppId && saved.ebayDevId && saved.ebayCertId && saved.ebayUserToken) ||
        (saved.ebayAppId && saved.ebayOAuthClientSecret && saved.ebayOAuthRefreshToken)
      ),
      hasEbayOAuth: !!saved.ebayOAuthRefreshToken,
      inventoryCheckerBaseUrl: saved.inventoryCheckerBaseUrl ?? "",
      hasInventoryCheckerApiKey: !!saved.inventoryCheckerApiKey,
      inventoryStatusColumnIndex: saved.inventoryStatusColumnIndex ?? 5,
      ebayListingConditionColumnIndex: saved.ebayListingConditionColumnIndex ?? undefined,
      ebayOAuthRedirectUri: saved.ebayOAuthRedirectUri ?? "",
      isConfigured: saved.isConfigured,
      hasServiceAccount: !!saved.serviceAccountJson,
    });
  } catch (err) {
    req.log.error({ err }, "saveSpreadsheetConfig failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/spreadsheet/monitors/sync", async (req, res) => {
  try {
    const result = await runMonitorSyncPipeline();
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "runMonitorSyncPipeline failed");
    res.status(500).json({ error: "sync_failed", message: err.message });
  }
});

router.post("/spreadsheet/inventory/sync", async (req, res) => {
  try {
    const result = await syncMonitorsFromInventoryChecker();
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "syncMonitorsFromInventoryChecker failed");
    res.status(500).json({ error: "sync_failed", message: err.message });
  }
});

router.post("/spreadsheet/inventory/remote-sync", async (req, res) => {
  try {
    const [cfg] = await db.select().from(spreadsheetConfigTable).limit(1);
    const base =
      cfg?.inventoryCheckerBaseUrl?.trim() ||
      process.env.EBAY_INVENTORY_SYNC_BASE_URL?.trim() ||
      "";
    if (!base) {
      res.status(400).json({ error: "inventory_base_url_not_configured" });
      return;
    }
    const result = await triggerInventoryCheckerSync({
      baseUrl: base,
      apiKey: cfg?.inventoryCheckerApiKey,
    });
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "triggerInventoryCheckerSync failed");
    res.status(500).json({ error: "sync_failed", message: err.message });
  }
});

router.post("/spreadsheet/test", async (req, res) => {
  try {
    const result = await testSheetsConnection();
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "testSpreadsheetConnection failed");
    res.json({ success: false, message: err.message });
  }
});

router.post("/spreadsheet/columns/suggest", async (req, res) => {
  try {
    const result = await suggestSpreadsheetColumns();
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "suggestSpreadsheetColumns failed");
    res.status(500).json({ error: "suggest_failed", message: err.message });
  }
});

router.post("/spreadsheet/sync", async (req, res) => {
  try {
    const result = await syncAlertsToSpreadsheet();
    res.json({
      synced: result.synced,
      failed: result.failed,
      message: `${result.synced}件同期完了${result.failed > 0 ? `、${result.failed}件失敗` : ""}`,
    });
  } catch (err: any) {
    req.log.error({ err }, "syncToSpreadsheet failed");
    res.status(500).json({ error: "sync_failed", message: err.message });
  }
});

router.get("/spreadsheet/row/:row", async (req, res) => {
  const row = parseInt(req.params.row);
  if (isNaN(row) || row < 1) {
    res.status(400).json({ error: "invalid row number" });
    return;
  }

  try {
    const result = await getRowPrice(row);
    res.json({
      rowNumber: row,
      myPrice: result.myPrice,
      rawValue: result.rawValue,
      found: result.found,
    });
  } catch (err: any) {
    req.log.error({ err }, "getSpreadsheetRow failed");
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

export default router;
