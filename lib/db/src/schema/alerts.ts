import {
  pgTable,
  serial,
  numeric,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { monitorsTable } from "./monitors";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitorsTable.id, { onDelete: "cascade" }),
  competitorPrice: numeric("competitor_price", { precision: 10, scale: 2 }).notNull(),
  competitorCondition: text("competitor_condition"),
  myPrice: numeric("my_price", { precision: 10, scale: 2 }).notNull(),
  priceDiff: numeric("price_diff", { precision: 10, scale: 2 }).notNull(),
  isResolved: boolean("is_resolved").notNull().default(false),
  spreadsheetSynced: boolean("spreadsheet_synced").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
