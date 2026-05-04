import {
  pgTable,
  serial,
  numeric,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { monitorsTable } from "./monitors";

export const priceHistoryTable = pgTable("price_history", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitorsTable.id, { onDelete: "cascade" }),
  lowestPrice: numeric("lowest_price", { precision: 10, scale: 2 }).notNull(),
  lowestCondition: text("lowest_condition"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const insertPriceHistorySchema = createInsertSchema(priceHistoryTable).omit({ id: true });
export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type PriceHistory = typeof priceHistoryTable.$inferSelect;
