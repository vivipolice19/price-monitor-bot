import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const spreadsheetConfigTable = pgTable("spreadsheet_config", {
  id: serial("id").primaryKey(),
  spreadsheetId: text("spreadsheet_id"),
  sheetName: text("sheet_name").default("在庫管理"),
  // Existing sheet layout: G=alert, H=last-check, new monitoring columns start at I.
  alertColumnIndex: integer("alert_column_index").default(6),
  priceColumnIndex: integer("price_column_index").default(8),
  myPriceColumnIndex: integer("my_price_column_index").default(3),
  sourceUrlColumnIndex: integer("source_url_column_index").default(0),
  ebayUrlColumnIndex: integer("ebay_url_column_index").default(1),
  lowestPriceColumnIndex: integer("lowest_price_column_index").default(8),
  lowestConditionColumnIndex: integer("lowest_condition_column_index").default(9),
  lastCheckColumnIndex: integer("last_check_column_index").default(7),
  alertStatusColumnIndex: integer("alert_status_column_index").default(10),
  repricedValueColumnIndex: integer("repriced_value_column_index").default(11),
  evidenceUrlsColumnIndex: integer("evidence_urls_column_index").default(12),
  trackedTargetUrlColumnIndex: integer("tracked_target_url_column_index").default(13),
  trackedTargetConditionColumnIndex: integer("tracked_target_condition_column_index").default(14),
  trackedTargetPriceColumnIndex: integer("tracked_target_price_column_index").default(15),
  autoRepriceEnabled: boolean("auto_reprice_enabled").notNull().default(false),
  undercutAmount: numeric("undercut_amount", { precision: 10, scale: 2 }).notNull().default("0.01"),
  minAllowedPrice: numeric("min_allowed_price", { precision: 10, scale: 2 }),
  ebayAppId: text("ebay_app_id"),
  ebayDevId: text("ebay_dev_id"),
  ebayCertId: text("ebay_cert_id"),
  ebayUserToken: text("ebay_user_token"),
  inventoryCheckerBaseUrl: text("inventory_checker_base_url"),
  inventoryCheckerApiKey: text("inventory_checker_api_key"),
  inventoryStatusColumnIndex: integer("inventory_status_column_index").default(5),
  ebayListingConditionColumnIndex: integer("ebay_listing_condition_column_index"),
  ebayOAuthRefreshToken: text("ebay_oauth_refresh_token"),
  ebayOAuthAccessToken: text("ebay_oauth_access_token"),
  ebayOAuthAccessExpiresAt: timestamp("ebay_oauth_access_expires_at"),
  ebayOAuthRedirectUri: text("ebay_oauth_redirect_uri"),
  ebayOAuthClientSecret: text("ebay_oauth_client_secret"),
  serviceAccountJson: text("service_account_json"),
  isConfigured: boolean("is_configured").notNull().default(false),
});

export const insertSpreadsheetConfigSchema = createInsertSchema(spreadsheetConfigTable).omit({ id: true });
export type InsertSpreadsheetConfig = z.infer<typeof insertSpreadsheetConfigSchema>;
export type SpreadsheetConfig = typeof spreadsheetConfigTable.$inferSelect;
