import { google, type sheets_v4 } from "googleapis";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { spreadsheetConfigTable, alertsTable, monitorsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchInventoryCheckerProducts } from "./inventoryChecker";
import { extractItemIdFromUrl, fetchListingCondition } from "./ebay";

async function getSheets(): Promise<{ sheets: sheets_v4.Sheets; config: typeof spreadsheetConfigTable.$inferSelect } | null> {
  const configs = await db.select().from(spreadsheetConfigTable).limit(1);
  const config = configs[0];

  if (!config || !config.serviceAccountJson || !config.spreadsheetId) {
    return null;
  }

  try {
    const serviceAccount = JSON.parse(config.serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    return { sheets, config };
  } catch (err) {
    logger.error({ err }, "Failed to initialize Google Sheets auth");
    return null;
  }
}

export async function testSheetsConnection(): Promise<{ success: boolean; message: string; sheetTitle?: string }> {
  const result = await getSheets();
  if (!result) {
    return { success: false, message: "スプレッドシートが設定されていません。設定ページでService AccountのJSONとSpreadsheet IDを入力してください。" };
  }

  const { sheets, config } = result;
  try {
    const resp = await sheets.spreadsheets.get({
      spreadsheetId: config.spreadsheetId!,
    });

    const sheet = resp.data.sheets?.find(
      (s) => s.properties?.title === config.sheetName
    );

    return {
      success: true,
      message: `接続成功: "${resp.data.properties?.title}"`,
      sheetTitle: sheet?.properties?.title || resp.data.properties?.title || undefined,
    };
  } catch (err: any) {
    logger.error({ err }, "Sheets connection test failed");
    return { success: false, message: `接続失敗: ${err.message}` };
  }
}

function columnIndexToLetter(index: number): string {
  let col = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function toNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const normalized = value.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function ensureMonitoringHeaders(): Promise<void> {
  const result = await getSheets();
  if (!result) return;

  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) return;

  const updates = [
    { col: config.lowestPriceColumnIndex ?? 8, title: "最安値(同一商品)" },
    { col: config.lowestConditionColumnIndex ?? 9, title: "最安値コンディション" },
    { col: config.lastCheckColumnIndex ?? 10, title: "最終チェック" },
    { col: config.alertStatusColumnIndex ?? 11, title: "アラート状態" },
    { col: config.repricedValueColumnIndex ?? 12, title: "自動改定価格" },
    { col: config.evidenceUrlsColumnIndex ?? 13, title: "リサーチ根拠URL" },
    { col: config.trackedTargetUrlColumnIndex ?? 14, title: "追跡対象URL" },
    { col: config.trackedTargetConditionColumnIndex ?? 15, title: "追跡対象コンディション" },
    { col: config.trackedTargetPriceColumnIndex ?? 16, title: "追跡対象価格(USD)" },
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map(({ col, title }) => ({
        range: `${config.sheetName}!${columnIndexToLetter(col)}1`,
        values: [[title]],
      })),
    },
  });
}

export async function getRowPrice(rowNumber: number): Promise<{ found: boolean; myPrice?: number; rawValue?: string }> {
  const result = await getSheets();
  if (!result) {
    return { found: false };
  }

  const { sheets, config } = result;
  const colIndex = config.myPriceColumnIndex ?? 3;

  function columnIndexToLetterLocal(index: number): string {
    let col = "";
    let n = index + 1;
    while (n > 0) {
      const remainder = (n - 1) % 26;
      col = String.fromCharCode(65 + remainder) + col;
      n = Math.floor((n - 1) / 26);
    }
    return col;
  }

  const colLetter = columnIndexToLetterLocal(colIndex);
  const range = `${config.sheetName}!${colLetter}${rowNumber}`;

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId!,
      range,
    });

    const values = resp.data.values;
    if (!values || values.length === 0 || !values[0] || !values[0][0]) {
      return { found: false };
    }

    const rawValue = String(values[0][0]);
    const cleaned = rawValue.replace(/[^0-9.]/g, "");
    const myPrice = parseFloat(cleaned);

    if (isNaN(myPrice)) {
      return { found: true, rawValue, myPrice: undefined };
    }

    return { found: true, myPrice, rawValue };
  } catch (err) {
    logger.error({ err, rowNumber, range }, "Failed to read row from spreadsheet");
    return { found: false };
  }
}

function normalizeHeader(v: string | undefined): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export async function suggestSpreadsheetColumns(): Promise<{
  sourceUrlColumnIndex?: number;
  ebayUrlColumnIndex?: number;
  myPriceColumnIndex?: number;
  inventoryStatusColumnIndex?: number;
  ebayListingConditionColumnIndex?: number;
  trackedTargetUrlColumnIndex?: number;
  trackedTargetConditionColumnIndex?: number;
  trackedTargetPriceColumnIndex?: number;
  detectedFromHeaders: string[];
}> {
  const result = await getSheets();
  if (!result) {
    return { detectedFromHeaders: [] };
  }
  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) {
    return { detectedFromHeaders: [] };
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A1:AZ1`,
  });
  const headers = (resp.data.values?.[0] ?? []).map((v) => String(v));
  const normalized = headers.map(normalizeHeader);
  const findBy = (patterns: RegExp[]): number | undefined => {
    const idx = normalized.findIndex((h) => patterns.some((p) => p.test(h)));
    return idx >= 0 ? idx : undefined;
  };

  const sourceUrlColumnIndex = findBy([/仕入/, /mercari/, /source/, /元url/, /参考url/]);
  const ebayUrlColumnIndex = findBy([/ebayurl/, /ebay出品/, /itemurl/, /出品url/]);
  const myPriceColumnIndex = findBy([/自分の売価/, /myprice/, /ebayprice/, /priceusd/, /売価/]);
  const inventoryStatusColumnIndex = findBy([/在庫/, /status/, /ステータス/]);
  const ebayListingConditionColumnIndex = findBy([/コンディション/, /condition/, /状態/]);
  const trackedTargetUrlColumnIndex = findBy([/追跡対象url/, /targeturl/, /監視url/]);
  const trackedTargetConditionColumnIndex = findBy([/追跡対象コンディション/, /targetcondition/, /監視コンディション/]);
  const trackedTargetPriceColumnIndex = findBy([/追跡対象価格/, /targetprice/, /監視価格/]);

  return {
    sourceUrlColumnIndex,
    ebayUrlColumnIndex,
    myPriceColumnIndex,
    inventoryStatusColumnIndex,
    ebayListingConditionColumnIndex,
    trackedTargetUrlColumnIndex,
    trackedTargetConditionColumnIndex,
    trackedTargetPriceColumnIndex,
    detectedFromHeaders: headers,
  };
}

function isSoldOutInventoryStatus(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("売切") ||
    t.includes("sold") ||
    t.includes("out_of_stock") ||
    t.includes("out of stock")
  );
}

export async function syncMonitorsFromSpreadsheet(): Promise<{ created: number; updated: number; skipped: number }> {
  const result = await getSheets();
  if (!result) return { created: 0, updated: 0, skipped: 0 };

  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) return { created: 0, updated: 0, skipped: 0 };

  await ensureMonitoringHeaders();

  const sourceCol = config.sourceUrlColumnIndex ?? 0;
  const ebayCol = config.ebayUrlColumnIndex ?? 1;
  const myPriceCol = config.myPriceColumnIndex ?? 3;
  const statusCol = config.inventoryStatusColumnIndex ?? 5;
  const condCol = config.ebayListingConditionColumnIndex;

  const colIndices = [sourceCol, ebayCol, myPriceCol, statusCol];
  if (condCol != null && condCol >= 0) colIndices.push(condCol);
  const maxCol = Math.max(...colIndices);
  const range = `${config.sheetName}!A2:${columnIndexToLetter(maxCol)}3000`;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });

  const rows = resp.data.values ?? [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx] ?? [];
    const spreadsheetRow = idx + 2;
    const ebayUrl = row[ebayCol]?.toString().trim();
    const sourceUrl = row[sourceCol]?.toString().trim();
    const myPrice = toNumber(row[myPriceCol]);
    const statusText = row[statusCol]?.toString().trim();
    const soldOut = isSoldOutInventoryStatus(statusText);
    const listingCondition =
      condCol != null && condCol >= 0 ? row[condCol]?.toString().trim() : undefined;

    if (!ebayUrl || !ebayUrl.includes("ebay.")) {
      skipped++;
      continue;
    }
    if (myPrice === undefined) {
      skipped++;
      continue;
    }

    const existing = await db
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.spreadsheetRow, spreadsheetRow))
      .limit(1);

    if (soldOut) {
      if (existing.length > 0) {
        await db
          .update(monitorsTable)
          .set({
            ebayUrl,
            myPrice: String(myPrice),
            label: existing[0].label || sourceUrl || ebayUrl,
            isActive: false,
            checkIntervalMinutes: 360,
          })
          .where(eq(monitorsTable.id, existing[0].id));
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const myCondition =
      listingCondition && listingCondition.length > 0 ? listingCondition : "Unknown";

    if (existing.length > 0) {
      const current = existing[0];
      await db
        .update(monitorsTable)
        .set({
          ebayUrl,
          myPrice: String(myPrice),
          myCondition: myCondition !== "Unknown" ? myCondition : current.myCondition,
          label: current.label || sourceUrl || ebayUrl,
          checkIntervalMinutes: 360,
          isActive: true,
        })
        .where(eq(monitorsTable.id, current.id));
      updated++;
      continue;
    }

    await db.insert(monitorsTable).values({
      ebayUrl,
      myPrice: String(myPrice),
      myCondition,
      label: sourceUrl || ebayUrl,
      spreadsheetRow,
      checkIntervalMinutes: 360,
      isActive: true,
    });
    created++;
  }

  return { created, updated, skipped };
}

export async function syncMonitorsFromInventoryChecker(): Promise<{
  updated: number;
  created: number;
  skipped: boolean;
}> {
  const [cfg] = await db.select().from(spreadsheetConfigTable).limit(1);
  const base =
    cfg?.inventoryCheckerBaseUrl?.trim() ||
    process.env.EBAY_INVENTORY_SYNC_BASE_URL?.trim() ||
    "";
  if (!base) {
    return { updated: 0, created: 0, skipped: true };
  }

  const data = await fetchInventoryCheckerProducts({
    baseUrl: base,
    apiKey: cfg?.inventoryCheckerApiKey,
  });

  const monitors = await db.select().from(monitorsTable);
  const byInventoryId = new Map<number, (typeof monitors)[0]>();
  const byEbayItemId = new Map<string, (typeof monitors)[0]>();
  for (const m of monitors) {
    if (m.inventoryProductId != null) {
      byInventoryId.set(m.inventoryProductId, m);
    }
    const iid = extractItemIdFromUrl(m.ebayUrl);
    if (iid) byEbayItemId.set(iid, m);
  }

  let updated = 0;
  let created = 0;

  for (const p of data.products) {
    const ebayUrl = p.ebay_url?.trim();
    if (!ebayUrl) continue;
    const itemId = extractItemIdFromUrl(ebayUrl);
    const isActive = p.status === "active";

    let existing = byInventoryId.get(p.id) ?? (itemId ? byEbayItemId.get(itemId) : undefined);

    if (existing) {
      await db
        .update(monitorsTable)
        .set({
          inventoryProductId: p.id,
          ebayUrl,
          myPrice: String(p.ebay_price_usd),
          isActive,
          label: p.mercari_url || existing.label,
        })
        .where(eq(monitorsTable.id, existing.id));
      updated++;
      const refreshed = { ...existing, inventoryProductId: p.id, ebayUrl, isActive };
      byInventoryId.set(p.id, refreshed);
      if (itemId) byEbayItemId.set(itemId, refreshed);
      continue;
    }

    if (!isActive) continue;

    const [inserted] = await db
      .insert(monitorsTable)
      .values({
        ebayUrl,
        myPrice: String(p.ebay_price_usd),
        myCondition: "Unknown",
        label: p.mercari_url || ebayUrl,
        spreadsheetRow: null,
        inventoryProductId: p.id,
        checkIntervalMinutes: 360,
        isActive: true,
      })
      .returning();
    if (inserted) {
      created++;
      byInventoryId.set(p.id, inserted);
      const nid = extractItemIdFromUrl(inserted.ebayUrl);
      if (nid) byEbayItemId.set(nid, inserted);
    }
  }

  return { updated, created, skipped: false };
}

export async function hydrateUnknownMonitorConditions(limit = 25): Promise<number> {
  const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
  const appId = config?.ebayAppId ?? process.env.EBAY_APP_ID ?? null;
  if (!appId) return 0;

  const rows = await db.select().from(monitorsTable).where(eq(monitorsTable.myCondition, "Unknown")).limit(limit);

  let n = 0;
  for (const m of rows) {
    const cond = await fetchListingCondition(m.ebayUrl, appId);
    if (cond && cond !== "Unknown") {
      await db.update(monitorsTable).set({ myCondition: cond }).where(eq(monitorsTable.id, m.id));
      n++;
    }
  }
  return n;
}

export async function linkMonitorsToSpreadsheetRows(): Promise<number> {
  const result = await getSheets();
  if (!result) return 0;
  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) return 0;

  const ebayCol = config.ebayUrlColumnIndex ?? 1;
  const range = `${config.sheetName}!A2:${columnIndexToLetter(ebayCol)}3000`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });
  const rows = resp.data.values ?? [];

  const monitors = await db.select().from(monitorsTable);
  const byItemId = new Map<string, typeof monitorsTable.$inferSelect>();
  for (const m of monitors) {
    const id = extractItemIdFromUrl(m.ebayUrl);
    if (id) byItemId.set(id, m);
  }

  let linked = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx] ?? [];
    const spreadsheetRow = idx + 2;
    const ebayUrl = row[ebayCol]?.toString().trim();
    if (!ebayUrl?.includes("ebay.")) continue;
    const itemId = extractItemIdFromUrl(ebayUrl);
    if (!itemId) continue;
    const m = byItemId.get(itemId);
    if (!m) continue;
    if (m.spreadsheetRow === spreadsheetRow) continue;
    await db
      .update(monitorsTable)
      .set({ spreadsheetRow })
      .where(eq(monitorsTable.id, m.id));
    linked++;
    byItemId.set(itemId, { ...m, spreadsheetRow });
  }
  return linked;
}

export async function runMonitorSyncPipeline(): Promise<{
  sheet: { created: number; updated: number; skipped: number };
  inventory: { updated: number; created: number; skipped: boolean };
  hydratedConditions: number;
  linkedRows: number;
}> {
  const sheet = await syncMonitorsFromSpreadsheet();
  const inventory = await syncMonitorsFromInventoryChecker();
  const linkedRows = await linkMonitorsToSpreadsheetRows();
  const hydratedConditions = await hydrateUnknownMonitorConditions(30);
  return { sheet, inventory, hydratedConditions, linkedRows };
}

export async function updateMonitorRowStatus(params: {
  row: number;
  lowestPrice: number;
  lowestCondition: string;
  checkedAt: Date;
  alertStatus: string;
  repricedValue?: number;
  evidenceUrls?: string[];
  trackedTargetUrl?: string;
  trackedTargetCondition?: string;
  trackedTargetPrice?: number;
}): Promise<void> {
  const result = await getSheets();
  if (!result) return;

  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) return;

  const lowestPriceCol = columnIndexToLetter(config.lowestPriceColumnIndex ?? 8);
  const lowestConditionCol = columnIndexToLetter(config.lowestConditionColumnIndex ?? 9);
  const lastCheckCol = columnIndexToLetter(config.lastCheckColumnIndex ?? 10);
  const alertStatusCol = columnIndexToLetter(config.alertStatusColumnIndex ?? 11);
  const repricedCol = columnIndexToLetter(config.repricedValueColumnIndex ?? 12);
  const evidenceCol = columnIndexToLetter(config.evidenceUrlsColumnIndex ?? 13);
  const trackedTargetUrlCol = columnIndexToLetter(config.trackedTargetUrlColumnIndex ?? 14);
  const trackedTargetConditionCol = columnIndexToLetter(config.trackedTargetConditionColumnIndex ?? 15);
  const trackedTargetPriceCol = columnIndexToLetter(config.trackedTargetPriceColumnIndex ?? 16);

  const evidence = (params.evidenceUrls ?? []).slice(0, 5).join("\n");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${config.sheetName}!${lowestPriceCol}${params.row}`, values: [[params.lowestPrice]] },
        { range: `${config.sheetName}!${lowestConditionCol}${params.row}`, values: [[params.lowestCondition]] },
        { range: `${config.sheetName}!${lastCheckCol}${params.row}`, values: [[params.checkedAt.toISOString().replace("T", " ").slice(0, 19)]] },
        { range: `${config.sheetName}!${alertStatusCol}${params.row}`, values: [[params.alertStatus]] },
        { range: `${config.sheetName}!${repricedCol}${params.row}`, values: [[params.repricedValue ?? ""]]},
        { range: `${config.sheetName}!${evidenceCol}${params.row}`, values: [[evidence]] },
        { range: `${config.sheetName}!${trackedTargetUrlCol}${params.row}`, values: [[params.trackedTargetUrl ?? ""]] },
        { range: `${config.sheetName}!${trackedTargetConditionCol}${params.row}`, values: [[params.trackedTargetCondition ?? ""]] },
        { range: `${config.sheetName}!${trackedTargetPriceCol}${params.row}`, values: [[params.trackedTargetPrice ?? ""]] },
      ],
    },
  });
}

export async function updateTrackedTargetCells(params: {
  row: number;
  trackedTargetUrl: string;
  trackedTargetCondition?: string;
  trackedTargetPrice?: number;
}): Promise<void> {
  const result = await getSheets();
  if (!result) return;
  const { sheets, config } = result;
  if (!config.spreadsheetId || !config.sheetName) return;

  const trackedTargetUrlCol = columnIndexToLetter(config.trackedTargetUrlColumnIndex ?? 14);
  const trackedTargetConditionCol = columnIndexToLetter(config.trackedTargetConditionColumnIndex ?? 15);
  const trackedTargetPriceCol = columnIndexToLetter(config.trackedTargetPriceColumnIndex ?? 16);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${config.sheetName}!${trackedTargetUrlCol}${params.row}`, values: [[params.trackedTargetUrl]] },
        {
          range: `${config.sheetName}!${trackedTargetConditionCol}${params.row}`,
          values: [[params.trackedTargetCondition ?? ""]],
        },
        {
          range: `${config.sheetName}!${trackedTargetPriceCol}${params.row}`,
          values: [[params.trackedTargetPrice ?? ""]],
        },
      ],
    },
  });
}

export async function syncAlertsToSpreadsheet(): Promise<{ synced: number; failed: number }> {
  const result = await getSheets();
  if (!result) return { synced: 0, failed: 0 };

  const { sheets, config } = result;

  const unsyncedAlerts = await db
    .select({
      alert: alertsTable,
      monitor: monitorsTable,
    })
    .from(alertsTable)
    .innerJoin(monitorsTable, eq(alertsTable.monitorId, monitorsTable.id))
    .where(and(eq(alertsTable.spreadsheetSynced, false), eq(alertsTable.isResolved, false)));

  let synced = 0;
  let failed = 0;

  const alertColLetter = columnIndexToLetter(config.alertColumnIndex ?? 10);
  const priceColLetter = columnIndexToLetter(config.priceColumnIndex ?? 11);

  for (const { alert, monitor } of unsyncedAlerts) {
    if (!monitor.spreadsheetRow) {
      continue;
    }

    try {
      const row = monitor.spreadsheetRow;
      const alertMessage = `⚠️ 競合価格: $${alert.competitorPrice} (${alert.competitorCondition || "不明"}) - 自分: $${alert.myPrice}`;
      const priceChange = `$${alert.competitorPrice}`;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId!,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            {
              range: `${config.sheetName}!${alertColLetter}${row}`,
              values: [[alertMessage]],
            },
            {
              range: `${config.sheetName}!${priceColLetter}${row}`,
              values: [[priceChange]],
            },
          ],
        },
      });

      await db.update(alertsTable)
        .set({ spreadsheetSynced: true })
        .where(eq(alertsTable.id, alert.id));

      synced++;
    } catch (err) {
      logger.error({ err, alertId: alert.id }, "Failed to sync alert to spreadsheet");
      failed++;
    }
  }

  return { synced, failed };
}
