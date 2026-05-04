import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitorsTable = pgTable("monitors", {
  id: serial("id").primaryKey(),
  ebayUrl: text("ebay_url").notNull(),
  myPrice: numeric("my_price", { precision: 10, scale: 2 }).notNull(),
  myCondition: text("my_condition").notNull(),
  label: text("label"),
  spreadsheetRow: integer("spreadsheet_row"),
  inventoryProductId: integer("inventory_product_id"),
  checkIntervalMinutes: integer("check_interval_minutes").notNull().default(360),
  isActive: boolean("is_active").notNull().default(true),
  currentLowestPrice: numeric("current_lowest_price", { precision: 10, scale: 2 }),
  currentLowestCondition: text("current_lowest_condition"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMonitorSchema = createInsertSchema(monitorsTable).omit({ id: true, createdAt: true });
export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type Monitor = typeof monitorsTable.$inferSelect;
