import { pgTable, serial, text, doublePrecision, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'RealEstate' | 'Aviation' | 'Marine' | 'PrivateClub' | 'ForbesList'
  identifier: text("identifier").notNull(), // parcel ID, tail number, IMO number, etc.
  jurisdiction: text("jurisdiction").notNull(), // 'Italy Catasto' | 'UK HMLR' | 'FAA' | 'IMO' | 'Forbes'
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  estimatedValue: doublePrecision("estimated_value"), // USD
  address: text("address"),
  description: text("description"),
  lastActivityDate: date("last_activity_date", { mode: "string" }),
  sourceRegistry: text("source_registry"),
  ownerEntityId: integer("owner_entity_id").references(() => entitiesTable.id, { onDelete: "set null" }),
  metadata: text("metadata"), // JSON blob (opensky enrichment, custom flags)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
