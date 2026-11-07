import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { entitiesTable } from "./entities";
import { assetsTable } from "./assets";

/**
 * Idempotency ledger for source-backed public-registry seeds.
 *
 * Every imported entity, asset, or attributed role/registrant relationship gets
 * a deterministic source key. This allows the same immutable CSV release to be
 * imported repeatedly without duplicating rows and lets later releases be
 * reconciled by source key.
 */
export const publicRegistrySeedRecordsTable = pgTable("public_registry_seed_records", {
  sourceKey: text("source_key").primaryKey(),
  recordType: text("record_type").notNull(), // entity | asset | relationship | manual_asset_lead
  sourceName: text("source_name").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  entityId: integer("entity_id").references(() => entitiesTable.id, { onDelete: "set null" }),
  relatedEntityId: integer("related_entity_id").references(() => entitiesTable.id, { onDelete: "set null" }),
  assetId: integer("asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
